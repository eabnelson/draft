import {test,expect} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DraftStore} from '../desktop/documents';
import {ZoSync,workspaceOf,parseCredentials,normalizeFolder,SYNC_INDEX,CHECK_MS,IDLE_CHECK_MS,AUDIT_MS,type Secrets} from '../desktop/zo-sync';
import {fresh,editVersion,addVersion,type Draft} from '../src/model';

const CLAIMS='https://zo.computer/claims/system-api';
const BASE='/workspace/Draft';
const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
const jwt=(claims:object)=>`e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const env=(id='cred1',secret='secret-1')=>`ZO_SYSTEM_API_CLIENT_ID=${id}\nZO_SYSTEM_API_CLIENT_SECRET=${secret}\n`;

class MemorySecrets implements Secrets{
  values=new Map<string,string>();
  async get(a:string){return this.values.get(a)??null;}
  async set(a:string,v:string){this.values.set(a,v);}
  async delete(a:string){this.values.delete(a);}
}

// A small stand-in for Zo: client-credential tokens, and Knowledge files by path, with a trash,
// folder moves that keep file IDs, a recursive search, and download links.
function fakeZo(){
  type File={id:string;revision:number;content:Uint8Array;updatedAt:number};
  const files=new Map<string,File>(),trash=new Map<string,File&{path:string}>(),uploads=new Map<string,{path:string;bytes?:Uint8Array}>();
  const calls:string[]=[],credentials=new Map([['cred1','secret-1']]),folders=new Set(['/workspace','/shared','/workspace/Writing','/workspace/Plans']);
  let access=new Set<string>(),serial=0,flaky=new Set<string>(['zo.file.create']),racing=0,exchanges=0,expiresIn=300,canUpdate=true,workspaceHidden=false,homeHidden=false,clock=Date.now();
  const hidden=new Set<string>();let duringUpdate:(()=>void)|undefined,duringIndexUpdate:(()=>Promise<void>)|undefined,failIndex=false,repeatPages=false;const listInputs:{input:any;query:any}[]=[],gets:{action:string;etag:string|null;workspace:string}[]=[];
  const error=(code:string,status=400)=>Response.json({request_id:'r',error:{code,message:code,details:{outcome:'not_started'}}},{status});
  const find=(id:string)=>[...files.entries()].find(([,f])=>f.id===id);
  const tick=()=>++clock;
  const ancestors=(path:string)=>{const parts=path.split('/'),out:string[]=[];for(let i=2;i<parts.length;i++)out.push(parts.slice(0,i).join('/'));return out;};
  const allFolders=()=>new Set([...folders,...[...files.keys(),...[...trash.values()].map(t=>t.path)].flatMap(ancestors)]);
  const server=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/zo-system-api/oauth/token'){
      const form=new URLSearchParams(await request.text());exchanges++;
      if(form.get('resource')!==`http://127.0.0.1:${server.port}/zo-system-api`||form.get('grant_type')!=='client_credentials')return Response.json({error:'invalid_request'},{status:400});
      if(credentials.get(form.get('client_id')!)!==form.get('client_secret'))return Response.json({error:'invalid_client'},{status:401});
      const token=jwt({[CLAIMS]:{workspace_id:'wsp_test',credential_id:form.get('client_id')},n:++serial});access.add(token);
      return Response.json({access_token:token,token_type:'Bearer',expires_in:expiresIn});
    }
    if(url.pathname.startsWith('/upload/')&&request.method==='PUT'){const u=uploads.get(url.pathname.slice(8));if(!u)return new Response(null,{status:404});u.bytes=new Uint8Array(await request.arrayBuffer());return new Response(null,{status:200});}
    if(url.pathname.startsWith('/download/')){const found=find(url.pathname.slice(10));return found?new Response(found[1].content):new Response(null,{status:404});}
    const get=/^\/zo-system-api\/v1\/invoke\/([^/]+)\/v1\/(.+)$/.exec(url.pathname);
    if(url.pathname!=='/zo-system-api/v1/invoke'&&!get)return new Response('no',{status:404});
    if(!access.has(request.headers.get('authorization')?.slice(7)??''))return error('unauthenticated',401);
    const {action,input,options}=get?{action:get[2],input:JSON.parse(url.searchParams.get('input')!),options:{}}:await request.json() as any;calls.push(action);
    if(get){gets.push({action,etag:request.headers.get('if-none-match'),workspace:get[1]});expect(request.headers.has('Zo-Workspace-Id')).toBe(false);}
    if(flaky.delete(action))return error('implementation_unavailable',503);
    const view=(path:string)=>{const f=files.get(path)!;return {id:f.id,revision:f.revision,name:path.split('/').pop(),current_version_id:`v${f.revision}`,updated_at:new Date(f.updatedAt).toISOString(),deleted_at:null};};
    const children=(at:string)=>[...allFolders()].filter(p=>p.startsWith(at+'/')&&p.split('/').length===at.split('/').length+1).map(p=>({kind:'folder',path:p,folder:{name:p.split('/').pop()}}));
    const put=(path:string,content:Uint8Array)=>{files.set(path,{id:`f${++serial}`,revision:1,content,updatedAt:tick()});return Response.json({result:view(path)});};
    switch(action){
      case 'zo.kb.list':{
        listInputs.push({input,query:options?.query});
        if(!input.path&&homeHidden)return error('permission_denied',403);
        if(!input.path)return Response.json({result:{view:'home',entries:[{kind:'folder',path:'/shared',folder:{name:'shared'}},{kind:'folder',path:'/workspace',folder:{name:'workspace'}}],next_cursor:null}});
        if(!allFolders().has(input.path))return error('resource_not_found',404);
        // Two pages, so the cursor is followed.
        const after=options?.query?.filter?.updated_after;
        const all=[...after?[]:children(input.path),...[...files.keys()].filter(p=>p.startsWith(input.path+'/')&&!p.slice(input.path.length+1).includes('/')&&!hidden.has(p)&&(!after||files.get(p)!.updatedAt>Date.parse(after))).map(p=>({kind:'file',path:p,file:view(p),md5:createHash('md5').update(files.get(p)!.content).digest('hex')}))],cursor=options?.query?.cursor??null;
        return Response.json({result:{view:'folder',folder:{id:`fold:${input.path}`,path:input.path},entries:cursor?all.slice(1):all.slice(0,1),next_cursor:repeatPages?'repeat':cursor||all.length<2?null:'next'}});
      }
      case 'zo.kb.search':{
        const at=String(input.folder_id).slice(5),start=Number(options?.query?.cursor??0),limit=options?.query?.limit??20;
        const all=[...files.entries()].filter(([p])=>p.startsWith(at+'/')&&p.includes(input.query)&&!hidden.has(p)).sort((a,b)=>b[1].updatedAt-a[1].updatedAt);
        return Response.json({result:{hits:all.slice(start,start+limit).map(([p,f])=>({source:'file',path:p,file:{id:f.id,revision:f.revision,updated_at:new Date(f.updatedAt).toISOString()}})),next_cursor:start+limit<all.length?String(start+limit):null}});
      }
      case 'zo.folder.create':{const path=`${input.parent_path}/${input.name}`;if(allFolders().has(path)||files.has(path))return error('conflict',409);folders.add(path);return Response.json({result:{id:`fold:${path}`,name:input.name,revision:1}});}
      case 'zo.folder.update':{
        const from=input.path,to=`${String(input.destination_folder_id).slice(5)}/${from.split('/').pop()}`;
        if(!allFolders().has(from))return error('resource_not_found',404);if(allFolders().has(to))return error('conflict',409);
        for(const [p,f] of [...files])if(p.startsWith(from+'/')){files.delete(p);files.set(to+p.slice(from.length),f);}
        for(const p of [...folders])if(p===from||p.startsWith(from+'/')){folders.delete(p);folders.add(to+p.slice(from.length));}
        return Response.json({result:{id:`fold:${to}`}});
      }
      case 'zo.folder.delete':{
        const path=input.path;if(!allFolders().has(path))return error('resource_not_found',404);
        if([...files.keys(),...[...trash.values()].map(t=>t.path)].some(p=>p.startsWith(path+'/'))||[...allFolders()].some(p=>p.startsWith(path+'/')))return error('conflict',409);
        folders.delete(path);return Response.json({result:{id:`fold:${path}`}});
      }
      case 'zo.workspace.get':if(workspaceHidden)return error('permission_denied',403);return Response.json({result:{id:input.workspace_id,display_name:'MyCloud'}});
      case 'zo.file.create':{
        if(input.upload_id){const u=uploads.get(input.upload_id)!;if(files.has(u.path))return error('conflict',409);return put(u.path,u.bytes!);}
        if(!input.create_parent_folders||!input.parent_path.startsWith('/workspace'))return error('resource_not_found',404);
        if(racing>0){racing--;return error('conflict',409);}
        const path=`${input.parent_path}/${input.name}`;if(files.has(path))return error('conflict',409);
        return put(path,new TextEncoder().encode(input.content));
      }
      case 'zo.file.prepare_create':{const id=`u${++serial}`;uploads.set(id,{path:`${input.parent_path}/${input.name}`});return Response.json({result:{upload_id:id,upload_url:`http://127.0.0.1:${server.port}/upload/${id}`}});}
      case 'zo.file.update':{
        if(!canUpdate)return error('permission_denied',403);
        if(find(input.file_id)?.[0]===`${BASE}/${SYNC_INDEX}`){if(failIndex)return error('unavailable',503);const race=duringIndexUpdate;duringIndexUpdate=undefined;await race?.();}
        const race=duringUpdate;duringUpdate=undefined;race?.();
        const found=find(input.file_id);if(!found)return error('resource_not_found',404);
        const [path,f]=found;if(input.expected_revision!==f.revision)return error('conflict',409);
        if(new TextDecoder().decode(f.content)===input.content)return Response.json({result:{...view(path),changed:false}});
        files.set(path,{...f,revision:f.revision+1,content:new TextEncoder().encode(input.content),updatedAt:tick()});return Response.json({result:view(path)});
      }
      case 'zo.file.get_metadata':{const path=input.path??find(input.file_id)?.[0];if(!path||!files.has(path))return error('resource_not_found',404);const result=view(path),etag=`"${result.id}-${result.revision}"`;return get&&request.headers.get('if-none-match')===etag?new Response(null,{status:304}):Response.json({result},{headers:get?{ETag:etag}:{}});}
      case 'zo.file.read':{const found=input.path?files.has(input.path)?[input.path,files.get(input.path)!] as const:undefined:find(input.file_id);if(!found)return error('resource_not_found',404);return Response.json({result:{file:view(found[0]),content:input.format==='text'?{format:'text',text:new TextDecoder().decode(found[1].content)}:{format:'url',url:`http://127.0.0.1:${server.port}/download/${found[1].id}`}}});}
      case 'zo.file.delete':{const found=find(input.file_id);if(!found)return error('resource_not_found',404);files.delete(found[0]);trash.set(found[1].id,{...found[1],path:found[0]});return Response.json({result:{id:found[1].id}});}
      case 'zo.file.purge':{if(!trash.delete(input.file_id))return error('resource_not_found',404);return Response.json({result:{job_id:'1'}});}
    }
    return error('unknown_action',404);
  }});
  const at=(path:string,base=BASE)=>`${base}/${path}`;
  return {server,files,trash,calls,credentials,folders,listInputs,gets,
    duringUpdate(run:()=>void){duringUpdate=run;},repeatPages(){repeatPages=true;},
    duringIndexUpdate(run:()=>Promise<void>){duringIndexUpdate=run;},failIndexUpdates(value:boolean){failIndex=value;},
    origin:`http://127.0.0.1:${server.port}`,
    text:(path:string,base=BASE)=>new TextDecoder().decode(files.get(at(path,base))?.content),
    has:(path:string,base=BASE)=>files.has(at(path,base)),
    folder:(path:string)=>allFolders().has(path),
    id:(path:string)=>files.get(at(path))?.id,
    // Someone changing a file in Zo directly.
    edit(path:string,text:string){const f=files.get(at(path))!;files.set(at(path),{...f,revision:f.revision+1,content:new TextEncoder().encode(text),updatedAt:tick()});},
    // Someone deleting a whole draft in Zo: its files go to the trash.
    removeDraft(prefix:string){for(const [p,f] of [...files])if(p.startsWith(at(prefix)+'/')){files.delete(p);trash.set(f.id,{...f,path:p});}},
    // Zo's search not having caught up with a file yet.
    hide(path:string){hidden.add(at(path));},
    unhide(){hidden.clear();},
    revoke(id:string){credentials.delete(id);access=new Set();},
    shortTokens(){expiresIn=1;},
    builderOnly(){canUpdate=false;},
    folderOnly(){workspaceHidden=true;homeHidden=true;},
    race(times:number){racing=times;},
    get exchanges(){return exchanges;},
  };
}

type Fixture={root:string;drafts:string;store:DraftStore;zo:ReturnType<typeof fakeZo>;secrets:MemorySecrets;sync:ZoSync};
async function fixture(run:(f:Fixture)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'draft-zo-'));const zo=fakeZo();
  try{
    const drafts=join(root,'Drafts'),store=new DraftStore(drafts),secrets=new MemorySecrets();
    await store.load();
    const sync=new ZoSync(root,store,{secrets,config:{authOrigin:zo.origin,apiOrigin:zo.origin},sleep:async()=>{},timers:false});
    await sync.initialize();
    await run({root,drafts,store,zo,secrets,sync});
  }finally{zo.server.stop(true);await rm(root,{recursive:true,force:true});}
}
// Connect, then choose the folder, as the Settings screen does.
async function link(f:Fixture,folder=BASE,credentials=env()){
  expect(await f.sync.connect({credentials})).toMatchObject({state:f.sync.status().folder?'waiting':'choose-folder'});
  return f.sync.chooseFolder(folder);
}
async function snapshot(folder:string){
  const out:Record<string,string>={};
  async function visit(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await visit(p);else out[p]=`${(await stat(p)).mtimeMs}:${await readFile(p,'base64')}`;}}
  await visit(folder);return out;
}

test('connecting checks the service account with Zo and keeps its secret only in the Keychain',()=>fixture(async f=>{
  expect(f.sync.status().state).toBe('off');
  await expect(f.sync.connect({credentials:'just some text'})).rejects.toThrow('.env file');
  await expect(f.sync.connect({credentials:env('cred1','wrong')})).rejects.toThrow('didn’t accept this credential');
  await expect(f.sync.connect({credentials:env(),folder:'Draft'})).rejects.toThrow('folder path');
  expect(f.secrets.values.size).toBe(0);
  expect(await f.sync.connect({credentials:env()})).toMatchObject({state:'choose-folder',workspace:'MyCloud'});
  expect([...f.secrets.values.values()]).toEqual(['secret-1']);
  // Nothing is saved until there is a folder.
  f.sync.changed();await f.sync.run();expect(f.zo.calls.filter(c=>c.startsWith('zo.file')).length).toBe(0);
  expect(()=>f.sync.syncNow()).toThrow('Choose a folder');
  expect(await f.sync.chooseFolder(BASE)).toMatchObject({state:'waiting',folder:BASE});
  const saved=await readFile(join(f.root,'zo-sync.json'),'utf8');
  expect(JSON.parse(saved)).toMatchObject({clientId:'cred1',workspaceId:'wsp_test',base:BASE});
  expect(saved).not.toContain('secret-1');
  // It comes back after a restart.
  const again=new ZoSync(f.root,f.store,{secrets:f.secrets,config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},sleep:async()=>{},timers:false});
  await again.initialize();expect(again.status()).toMatchObject({state:'waiting',workspace:'MyCloud',folder:BASE});
}));

test('every draft, version and image is saved to the folder, and only changes are sent again',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'First thoughts.');
  const second=addVersion(d);d={...editVersion(second.draft,second.version.id,'Punchier.'),title:'Tiny software',titleSource:'manual'};
  await f.store.save(d);const {src}=await f.store.saveMedia(d.id,png,'image/png');
  await link(f);await f.sync.run();
  expect(f.sync.status()).toMatchObject({state:'synced',folder:BASE});
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('First thoughts.');
  expect(f.zo.text(`${d.id}.draft/versions/v2.md`)).toBe('Punchier.');
  expect(JSON.parse(f.zo.text(`${d.id}.draft/draft.json`)).id).toBe(d.id);
  expect(f.zo.files.get(`${BASE}/${d.id}.draft/${src}`)?.content).toEqual(png);
  expect(f.zo.text('Drafts.md')).toContain(`- Tiny software — \`${d.id}.draft\``);
  // Undo history stays on this Mac.
  expect([...f.zo.files.keys()].some(p=>p.includes('/history/'))).toBe(false);

  // Checking Zo again sends nothing when nothing changed.
  const writes=()=>f.zo.calls.filter(c=>['zo.file.create','zo.file.update','zo.file.delete','zo.file.prepare_create','zo.file.prepare_update','zo.folder.update'].includes(c));
  const sent=writes().length;await f.sync.run();
  expect(writes().length).toBe(sent);

  d=editVersion(d,d.versions[1].id,'Punchier still.');await f.store.save(d);await f.sync.run();
  expect(writes().slice(sent)).toEqual(['zo.file.update','zo.file.update','zo.file.update']);
  expect(f.zo.text(`${d.id}.draft/versions/v2.md`)).toBe('Punchier still.');
  expect(f.zo.files.get(`${BASE}/${d.id}.draft/versions/v2.md`)?.revision).toBe(2);
}));

test('writing changed both here and in Zo is kept twice, never lost',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Mine.');await f.store.save(d);
  await link(f);await f.sync.run();
  f.zo.edit(`${d.id}.draft/versions/v1.md`,'Edited in Zo.');
  d=editVersion(d,d.versions[0].id,'Mine, later.');await f.store.save(d);
  await f.sync.run();
  const here=await f.store.readAt(d.id,'live');
  expect(here.versions.map(v=>[v.number,v.text,v.name])).toEqual([[1,'Mine, later.',undefined],[2,'Edited in Zo.','Version 1 (from Zo)']]);
  // And Zo ends up with both.
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Mine, later.');
  expect(f.zo.text(`${d.id}.draft/versions/v2.md`)).toBe('Edited in Zo.');
  expect(f.sync.status().state).toBe('synced');
}));

test('a concurrent edit during upload is preserved until the next reconciliation',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Original.');await f.store.save(d);
  await link(f);await f.sync.run();
  d=editVersion(d,d.versions[0].id,'Local change.');await f.store.save(d);
  f.zo.duringUpdate(()=>f.zo.edit(`${d.id}.draft/versions/v1.md`,'Concurrent Zo change.'));
  await f.sync.run();expect(f.sync.status().state).toBe('error');
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Concurrent Zo change.');
  await f.sync.run();expect(f.sync.status().state).toBe('synced');
  expect((await f.store.readAt(d.id,'live')).versions.map(v=>v.text)).toEqual(['Local change.','Concurrent Zo change.']);
}));

test('full folder scans use hashes and reject repeated cursors',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Keep me.');await f.store.save(d);
  await link(f);await f.sync.run();await f.sync.run();
  const reads=f.zo.calls.filter(c=>c==='zo.file.read').length;
  const version=f.zo.files.get(`${BASE}/${d.id}.draft/versions/v1.md`)!;version.revision++;
  await f.sync.run();
  expect(f.zo.calls).not.toContain('zo.kb.search');
  expect(f.zo.calls.filter(c=>c==='zo.file.read').length).toBe(reads);
  f.zo.repeatPages();await f.sync.run();expect(f.sync.status().state).toBe('error');
  expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Keep me.');
}));

test('a file removed in Zo is saved again, and reconnecting takes over what is already there',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Hello.');await f.store.save(d);
  await link(f);await f.sync.run();
  f.zo.files.delete(`${BASE}/${d.id}.draft/versions/v1.md`);
  d=editVersion(d,d.versions[0].id,'Hello again.');await f.store.save(d);await f.sync.run();
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Hello again.');
  await f.sync.disconnect();expect(f.secrets.values.size).toBe(0);expect(f.sync.status().state).toBe('off');
  await link(f);d=editVersion(d,d.versions[0].id,'Hello once more.');await f.store.save(d);await f.sync.run();
  expect(f.sync.status().state).toBe('synced');
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Hello once more.');
  // Another folder starts its own copy.
  await f.sync.chooseFolder('/workspace/Writing/');await f.sync.run();
  expect(f.sync.status().folder).toBe('/workspace/Writing');
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`,'/workspace/Writing')).toBe('Hello once more.');
}));

test('a create that races with new folders in Zo is tried again',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Raced.');await f.store.save(d);
  await link(f);f.zo.race(2);await f.sync.run();
  expect(f.sync.status().state).toBe('synced');
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Raced.');
}));

test('tokens are exchanged again when they expire, and a revoked credential asks to connect again',()=>fixture(async f=>{
  for(let i=0;i<3;i++){let d=fresh();d=editVersion(d,d.versions[0].id,`Draft ${i}.`);await f.store.save(d);}
  f.zo.shortTokens();await link(f);
  const before=f.zo.exchanges;
  await Promise.all([f.sync.run(),f.sync.invoke('zo.workspace.get',{workspace_id:'wsp_test'}),f.sync.invoke('zo.workspace.get',{workspace_id:'wsp_test'})]);
  expect(f.sync.status().state).toBe('synced');
  expect(f.zo.exchanges).toBeGreaterThan(before);
  f.zo.revoke('cred1');
  let d=fresh();d=editVersion(d,d.versions[0].id,'After revoke.');await f.store.save(d);await f.sync.run();
  expect(f.sync.status()).toMatchObject({state:'needs-credentials',message:'Zo no longer accepts this service account. Connect again with a new credential.'});
  expect(()=>f.sync.syncNow()).toThrow();
  f.zo.credentials.set('cred2','secret-2');
  // A new credential for the same workspace keeps the folder.
  expect(await f.sync.connect({credentials:env('cred2','secret-2')})).toMatchObject({state:'waiting',folder:BASE});await f.sync.run();
  expect(f.sync.status().state).toBe('synced');
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('After revoke.');
}));

test('a service account that can only add files says what access it needs',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'One.');await f.store.save(d);
  await link(f);await f.sync.run();
  f.zo.builderOnly();
  d=editVersion(d,d.versions[0].id,'Two.');await f.store.save(d);
  const before=await snapshot(f.drafts);await f.sync.run();
  expect(f.sync.status()).toMatchObject({state:'error',message:`Draft can’t save to ${BASE}. In Zo, give its service account edit access to that folder, then choose Sync now.`});
  expect(await snapshot(f.drafts)).toEqual(before);
}));

// A second Mac connected to the same folder.
async function secondMac(f:Fixture,run:(m:{store:DraftStore;sync:ZoSync;drafts:string;root:string})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'draft-zo-mac-'));
  try{
    const drafts=join(root,'Drafts'),store=new DraftStore(drafts);await store.load();
    const sync=new ZoSync(root,store,{secrets:new MemorySecrets(),config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},sleep:async()=>{},timers:false});
    await sync.initialize();await sync.connect({credentials:env()});await sync.chooseFolder(BASE);
    await run({store,sync,drafts,root});
  }finally{await rm(root,{recursive:true,force:true});}
}
const written=(text:string,title='')=>{let d=fresh();d=editVersion(d,d.versions[0].id,text);return title?{...d,title,titleSource:'manual' as const}:d;};

test('an unchanged cloud check makes one conditional read and no folder scans or writes',()=>fixture(async f=>{
  const d=written('Already saved.');await f.store.save(d);await link(f);await f.sync.run();
  await f.sync.run(false); // Establish the response ETag after publishing.
  const before=f.zo.calls.length;
  await f.sync.run(false);
  expect(f.zo.calls.slice(before)).toEqual(['zo.file.get_metadata']);
  expect(f.zo.gets.at(-1)).toMatchObject({workspace:'wsp_test',action:'zo.file.get_metadata'});
  expect(f.zo.gets.at(-1)?.etag).toBeTruthy();
  expect(f.sync.status().state).toBe('synced');
}));

test('index changes bring new drafts, edits, moves and deletes to another Mac',()=>fixture(async f=>{
  let d=written('First.');await f.store.save(d);await link(f);await f.sync.run();
  await secondMac(f,async mac=>{
    await mac.sync.run(false);
    d=editVersion(d,d.versions[0].id,'Later.');await f.store.save(d);await f.sync.run(false);
    await mac.sync.run(false);expect((await mac.store.readAt(d.id,'live')).versions[0].text).toBe('Later.');
    await f.store.archive(d.id);await f.sync.run(false);await mac.sync.run(false);expect(await mac.store.place(d.id)).toBe('archived');
    await f.store.moveExternal(d.id,'live');await f.sync.run(false);await mac.sync.run(false);expect(await mac.store.place(d.id)).toBe('live');
    await f.store.delete(d.id);await f.sync.run(false);await mac.sync.run(false);expect(await mac.store.place(d.id)).toBe(null);
  });
}));

test('simultaneous index publishers preserve both changes and recheck an unseen publication',()=>fixture(async f=>{
  let a=written('A.'),b=written('B.');await f.store.save(a);await f.store.save(b);await link(f);await f.sync.run();
  await secondMac(f,async mac=>{
    await mac.sync.run(false);
    a=editVersion(a,a.versions[0].id,'A changed.');await f.store.save(a);
    let there=await mac.store.readAt(b.id,'live');there=editVersion(there,there.versions[0].id,'B changed.');await mac.store.save(there);
    f.zo.duringIndexUpdate(async()=>{await mac.sync.run(false);});
    await f.sync.run(false);
    expect(f.sync.status().state).toBe('synced');
    expect((await f.store.readAt(b.id,'live')).versions[0].text).toBe('B changed.');
    const index=JSON.parse(f.zo.text(SYNC_INDEX));expect(Object.keys(index.changes)).toContain(a.id);expect(Object.keys(index.changes)).toContain(b.id);
    await mac.sync.run(false);expect((await mac.store.readAt(a.id,'live')).versions[0].text).toBe('A changed.');
  });
}));

test('two Macs can bootstrap the index together without losing either library',()=>fixture(async f=>{
  const a=written('First Mac.');await f.store.save(a);await link(f);
  await secondMac(f,async mac=>{
    const b=written('Second Mac.');await mac.store.save(b);
    await Promise.all([f.sync.run(false),mac.sync.run(false)]);
    await f.sync.run(false);await mac.sync.run(false);
    expect(f.sync.status().state).toBe('synced');expect(mac.sync.status().state).toBe('synced');
    expect((await f.store.readAt(b.id,'live')).versions[0].text).toBe('Second Mac.');
    expect((await mac.store.readAt(a.id,'live')).versions[0].text).toBe('First Mac.');
    expect(Object.keys(JSON.parse(f.zo.text(SYNC_INDEX)).changes).sort()).toEqual([a.id,b.id].sort());
  });
}));

test('a deletion hint cannot delete writing and a missing index is rebuilt',()=>fixture(async f=>{
  const d=written('Still here.');await f.store.save(d);await link(f);await f.sync.run(false);
  const index=JSON.parse(f.zo.text(SYNC_INDEX));index.changes[d.id]={change:'untrusted-hint',place:'deleted'};f.zo.edit(SYNC_INDEX,JSON.stringify(index));
  await f.sync.run(false);expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Still here.');
  f.zo.files.delete(`${BASE}/${SYNC_INDEX}`);await f.sync.run(false);
  expect(f.sync.status().state).toBe('synced');expect(f.zo.has(SYNC_INDEX)).toBe(true);
  expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Still here.');
}));

test('an interrupted index publication survives restart and announces the uploaded files',()=>fixture(async f=>{
  let d=written('Before.');await f.store.save(d);await link(f);await f.sync.run();
  await secondMac(f,async mac=>{
    await mac.sync.run(false);
    d=editVersion(d,d.versions[0].id,'Uploaded before a crash.');await f.store.save(d);f.zo.failIndexUpdates(true);await f.sync.run(false);
    expect(f.sync.status().state).toBe('error');expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Uploaded before a crash.');
    const saved=JSON.parse(await readFile(join(f.root,'zo-sync.json'),'utf8'));expect(saved.pendingIndex[d.id]).toBeTruthy();
    f.zo.failIndexUpdates(false);
    const again=new ZoSync(f.root,f.store,{secrets:f.secrets,config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},sleep:async()=>{},timers:false});await again.initialize();await again.run(false);
    expect(again.status().state).toBe('synced');
    await mac.sync.run(false);expect((await mac.store.readAt(d.id,'live')).versions[0].text).toBe('Uploaded before a crash.');
  });
}));

test('activity uses a short foreground interval, backs off while idle, and throttles focus checks',()=>fixture(async f=>{
  await link(f);await f.sync.run(false);let now=Date.now();
  const sync=new ZoSync(f.root,f.store,{secrets:f.secrets,config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},now:()=>now});
  const waitFor=async(check:()=>boolean)=>{for(let i=0;i<200&&!check();i++)await Bun.sleep(5);expect(check()).toBe(true);};
  try{
    await sync.initialize();await waitFor(()=>sync.status().state==='synced');
    expect(sync.nextCheckDelay()).toBe(CHECK_MS);
    now+=6*60_000;expect(sync.nextCheckDelay()).toBe(IDLE_CHECK_MS);
    let before=f.zo.gets.length;sync.activity('foreground');await waitFor(()=>f.zo.gets.length>before&&sync.status().state==='synced');
    expect(sync.nextCheckDelay()).toBe(CHECK_MS);
    before=f.zo.gets.length;sync.activity('foreground');await Bun.sleep(15);expect(f.zo.gets.length).toBe(before);
    sync.activity('background');expect(sync.nextCheckDelay()).toBe(IDLE_CHECK_MS);
    now+=60_000;before=f.zo.gets.length;sync.activity('online');await waitFor(()=>f.zo.gets.length>before&&sync.status().state==='synced');
    expect(sync.nextCheckDelay()).toBe(IDLE_CHECK_MS);
  }finally{await sync.disconnect();}
}));

test('periodic and manual full scans find changes made without an index update',()=>fixture(async f=>{
  const d=written('Before.');await f.store.save(d);await link(f);await f.sync.run(false);
  f.zo.edit(`${d.id}.draft/versions/v1.md`,'From an older app.');
  await f.sync.run(false);expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Before.');
  const saved=JSON.parse(await readFile(join(f.root,'zo-sync.json'),'utf8'));saved.lastInventoryAt=Date.now()-AUDIT_MS-1;
  await Bun.write(join(f.root,'zo-sync.json'),JSON.stringify(saved));
  const again=new ZoSync(f.root,f.store,{secrets:f.secrets,config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},timers:false});await again.initialize();await again.run(false);
  expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('From an older app.');
  f.zo.edit(`${d.id}.draft/versions/v1.md`,'Manual check.');await again.run();expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Manual check.');
}));

test('a draft written on one Mac appears on the other, and edits travel both ways',()=>fixture(async f=>{
  let d=written('Started on the laptop.','Laptop draft');await f.store.save(d);
  await link(f);await f.sync.run();
  await secondMac(f,async mac=>{
    await mac.sync.run();
    expect((await mac.store.readAt(d.id,'live')).versions[0].text).toBe('Started on the laptop.');
    // The window there is told about it.
    expect((await mac.store.changesSince(0)).changes.some(c=>c.id===d.id&&c.draft?.title==='Laptop draft')).toBe(true);
    let there=await mac.store.readAt(d.id,'live');there=editVersion(there,there.versions[0].id,'Finished on the desktop.');await mac.store.save(there);
    await mac.sync.run();
  });
  const seq=(await f.store.changesSince(0)).seq;
  await f.sync.run();
  expect((await f.store.readAt(d.id,'live')).versions[0].text).toBe('Finished on the desktop.');
  const changes=await f.store.changesSince(seq);
  expect(changes.changes.map(c=>[c.id,c.draft?.versions[0].text])).toEqual([[d.id,'Finished on the desktop.']]);
  // Taking it in sends nothing back.
  const writes=f.zo.calls.filter(c=>c.startsWith('zo.file.update')||c.startsWith('zo.file.create')).length;await f.sync.run();
  expect(f.zo.calls.filter(c=>c.startsWith('zo.file.update')||c.startsWith('zo.file.create')).length).toBe(writes);
}));

test('deleting a draft on one Mac deletes it in Zo and on the other',()=>fixture(async f=>{
  const d=written('Short-lived.');await f.store.save(d);const keep=written('Stays.');await f.store.save(keep);
  await link(f);await f.sync.run();
  await secondMac(f,async mac=>{
    await mac.sync.run();expect(await mac.store.place(d.id)).toBe('live');
    await f.store.delete(d.id);await f.sync.run();
    expect(f.zo.has(`${d.id}.draft/draft.json`)).toBe(false);
    expect(f.zo.trash.size).toBe(0);
    expect(f.zo.has(`${keep.id}.draft/draft.json`)).toBe(true);
    // Its emptied folders go once Zo allows it.
    await f.sync.run();expect(f.zo.folder(`${BASE}/${d.id}.draft`)).toBe(false);
    const seq=(await mac.store.changesSince(0)).seq;
    await mac.sync.run();
    expect(await mac.store.place(d.id)).toBe(null);
    expect((await mac.store.deletedIds()).has(d.id)).toBe(true);
    expect((await mac.store.changesSince(seq)).changes).toEqual([expect.objectContaining({id:d.id,gone:'deleted'})]);
    expect(await mac.store.place(keep.id)).toBe('live');
  });
  // It does not come back.
  await f.sync.run();expect(await f.store.place(d.id)).toBe(null);expect(f.zo.has(`${d.id}.draft/draft.json`)).toBe(false);
}));

test('archiving moves the draft in Zo, keeping its files, and the other Mac follows',()=>fixture(async f=>{
  const d=written('Put away for now.');await f.store.save(d);
  await link(f);await f.sync.run();
  const fileId=f.zo.id(`${d.id}.draft/versions/v1.md`);
  await secondMac(f,async mac=>{
    await mac.sync.run();
    await f.store.archive(d.id);await f.sync.run();
    expect(f.zo.has(`${d.id}.draft/draft.json`)).toBe(false);
    expect(f.zo.id(`Archive/${d.id}.draft/versions/v1.md`)).toBe(fileId);
    await mac.sync.run();
    expect(await mac.store.place(d.id)).toBe('archived');
    expect((await mac.store.changesSince(0)).changes.find(c=>c.id===d.id)?.gone).toBe('archived');
    // Restored there, it comes back here.
    await mac.store.restoreLast();await mac.sync.run();
  });
  await f.sync.run();
  expect(await f.store.place(d.id)).toBe('live');
  expect(f.zo.id(`${d.id}.draft/versions/v1.md`)).toBe(fileId);
}));

test('a draft deleted in Zo leaves this Mac too, unless it was written in since',()=>fixture(async f=>{
  const gone=written('Deleted in Zo.');await f.store.save(gone);
  let kept=written('Deleted in Zo, but I kept writing.');await f.store.save(kept);
  const other=written('Untouched.');await f.store.save(other);
  const fourth=written('Also untouched.');await f.store.save(fourth);
  await link(f);await f.sync.run();
  f.zo.removeDraft(`${gone.id}.draft`);f.zo.removeDraft(`${kept.id}.draft`);
  kept=editVersion(kept,kept.versions[0].id,'Deleted in Zo, but I kept writing, and it wins.');await f.store.save(kept);
  await f.sync.run();
  expect(await f.store.place(gone.id)).toBe(null);
  expect((await f.store.deletedIds()).has(gone.id)).toBe(true);
  expect(await f.store.place(kept.id)).toBe('live');
  expect(f.zo.text(`${kept.id}.draft/versions/v1.md`)).toBe('Deleted in Zo, but I kept writing, and it wins.');
}));

test('when most drafts vanish from Zo at once, Draft keeps them and says so',()=>fixture(async f=>{
  const ids:string[]=[];for(let i=0;i<4;i++){const d=written(`Draft ${i}.`);await f.store.save(d);ids.push(d.id);}
  await link(f);await f.sync.run();
  for(const id of ids)f.zo.removeDraft(`${id}.draft`);
  await f.sync.run();
  for(const id of ids)expect(await f.store.place(id)).toBe('live');
  expect(f.sync.status().message).toContain('4 drafts are missing from /workspace/Draft');
}));

test('a file Zo’s search has not caught up with is not taken as removed',()=>fixture(async f=>{
  const d=written('Just saved.');await f.store.save(d);
  await link(f);await f.sync.run();
  f.zo.hide(`${d.id}.draft/versions/v1.md`);
  const before=await snapshot(f.drafts);await f.sync.run();
  expect(await snapshot(f.drafts)).toEqual(before);
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Just saved.');
  expect(f.sync.status().state).toBe('synced');
}));

test('a save that started before sync changed the draft is merged, keeping both',async()=>{
  const root=await mkdtemp(join(tmpdir(),'draft-merge-'));
  try{
    const store=new DraftStore(join(root,'Drafts'));await store.load();
    let d:Draft=written('Before.');const second=addVersion(d);d=editVersion(second.draft,second.version.id,'Second, untouched here.');
    await store.save(d);const seen=(await store.changesSince(0)).seq;
    // Sync brings in Zo's copy: both versions changed there, and a third added.
    const [v1,v2]=d.versions;let fromZo=editVersion(editVersion(d,v1.id,'Changed in Zo.'),v2.id,'Second, changed in Zo.');
    const third=addVersion(fromZo);fromZo=editVersion(third.draft,third.version.id,'New in Zo.');
    await store.writeExternal(fromZo,'live');
    // The window, not knowing, saves its own edit to the first version only.
    const result=await store.save(editVersion(d,v1.id,'Typed here.'),seen);
    expect(result.draft?.versions.map(v=>[v.text,v.name])).toEqual([['Typed here.',undefined],['Second, changed in Zo.',undefined],['New in Zo.',undefined],['Changed in Zo.','Version 1 (from Zo)']]);
    expect((await store.readAt(d.id,'live')).versions.map(v=>v.text)).toEqual(['Typed here.','Second, changed in Zo.','New in Zo.','Changed in Zo.']);
    // Once the window has the merged copy, saves are plain again.
    expect((await store.save(result.draft!,result.seq)).draft).toBeUndefined();
  }finally{await rm(root,{recursive:true,force:true});}
});

test('the folder can be chosen by browsing the workspace, or made new',()=>fixture(async f=>{
  await expect(f.sync.folders()).rejects.toThrow('Connect');
  await f.sync.connect({credentials:env()});
  expect(await f.sync.folders()).toEqual({path:null,parent:null,folders:[{name:'shared',path:'/shared'},{name:'workspace',path:'/workspace'}]});
  expect(await f.sync.folders('/workspace')).toEqual({path:'/workspace',parent:null,folders:[{name:'Plans',path:'/workspace/Plans'},{name:'Writing',path:'/workspace/Writing'}]});
  expect(await f.sync.createFolder('/workspace/Writing','Draft')).toEqual({name:'Draft',path:'/workspace/Writing/Draft'});
  await expect(f.sync.createFolder('/workspace/Writing','Draft')).rejects.toThrow('already something named Draft');
  await expect(f.sync.createFolder('/workspace/Writing','a/b')).rejects.toThrow('without slashes');
  expect((await f.sync.folders('/workspace/Writing')).parent).toBe('/workspace');
  let d=fresh();d=editVersion(d,d.versions[0].id,'Here.');await f.store.save(d);
  await f.sync.chooseFolder('/workspace/Writing/Draft');await f.sync.run();
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`,'/workspace/Writing/Draft')).toBe('Here.');
  // A draft's own folder is not offered as a place to save.
  expect((await f.sync.folders('/workspace/Writing/Draft')).folders).toEqual([]);
}));

// What an agent sends back after following Draft's setup prompt, wrapped the way it usually replies.
const agentBlock=(folder='/workspace/Writing')=>`Done. Paste this into Draft:\n\n\`\`\`\n${env().trim()}\nZO_WORKSPACE_NAME=eriks home\nDRAFT_ZO_FOLDER=${folder}\n\`\`\`\n`;

test('the setup prompt’s block connects straight to its folder, named even when Zo hides the workspace',()=>fixture(async f=>{
  f.zo.folderOnly();
  expect(await f.sync.connect({credentials:agentBlock()})).toMatchObject({state:'waiting',workspace:'eriks home',folder:'/workspace/Writing'});
  let d=fresh();d=editVersion(d,d.versions[0].id,'Saved where the agent set up.');await f.store.save(d);
  await f.sync.run();
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`,'/workspace/Writing')).toBe('Saved where the agent set up.');
  // An account that can’t see the top of the workspace gets a plain answer, not Zo’s.
  await expect(f.sync.folders()).rejects.toThrow('can’t see your folders');
  expect((await f.sync.folders('/workspace/Writing')).path).toBe('/workspace/Writing');
  // A plain .env without a name never shows the workspace’s ID in its place.
  await f.sync.disconnect();
  expect(await f.sync.connect({credentials:env()})).toMatchObject({state:'choose-folder',workspace:undefined});
}));

test('credentials, folders and workspaces are read the way Zo writes them',()=>{
  expect(parseCredentials(agentBlock('/workspace/Draft'))).toEqual({clientId:'cred1',clientSecret:'secret-1',workspaceName:'eriks home',folder:'/workspace/Draft'});
  expect(parseCredentials(`${env()}ZO_WORKSPACE_NAME="Zo Company"\nDRAFT_ZO_FOLDER=\n`)).toEqual({clientId:'cred1',clientSecret:'secret-1',workspaceName:'Zo Company'});
  expect(parseCredentials('ZO_SYSTEM_API_CLIENT_ID=credabc\nZO_SYSTEM_API_CLIENT_SECRET=Ss6I1j-_x\n')).toEqual({clientId:'credabc',clientSecret:'Ss6I1j-_x'});
  expect(parseCredentials('export ZO_SYSTEM_API_CLIENT_SECRET="sec"\n ZO_SYSTEM_API_CLIENT_ID = cid \n')).toEqual({clientId:'cid',clientSecret:'sec'});
  expect(()=>parseCredentials('ZO_SYSTEM_API_CLIENT_ID=only')).toThrow();
  expect(normalizeFolder('')).toBe(BASE);expect(normalizeFolder('/workspace/Writing/')).toBe('/workspace/Writing');
  for(const bad of ['workspace/Draft','/a/../b','/a//b'])expect(()=>normalizeFolder(bad)).toThrow();
  expect(workspaceOf(jwt({[CLAIMS]:{workspace_id:'wsp_unfur57ue5dd5ba7'}}))).toBe('wsp_unfur57ue5dd5ba7');
  expect(()=>workspaceOf('not-a-token')).toThrow();
});
