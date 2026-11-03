import {test,expect} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DraftStore} from '../desktop/documents';
import {ZoSync,workspaceOf,parseCredentials,normalizeFolder,type Secrets} from '../desktop/zo-sync';
import {fresh,editVersion,addVersion} from '../src/model';

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

// A small stand-in for Zo: client-credential tokens, and Knowledge files by path.
function fakeZo(){
  const files=new Map<string,{id:string;revision:number;content:Uint8Array}>(),uploads=new Map<string,{path:string;bytes?:Uint8Array}>();
  const calls:string[]=[],credentials=new Map([['cred1','secret-1']]),folders=new Set(['/workspace','/shared','/workspace/Writing','/workspace/Plans']);
  let access=new Set<string>(),serial=0,flaky=new Set<string>(['zo.file.create']),racing=0,exchanges=0,expiresIn=300,canUpdate=true,workspaceHidden=false,homeHidden=false;
  const error=(code:string,status=400)=>Response.json({request_id:'r',error:{code,message:code,details:{outcome:'not_started'}}},{status});
  const find=(id:string)=>[...files.entries()].find(([,f])=>f.id===id);
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
    if(url.pathname!=='/zo-system-api/v1/invoke')return new Response('no',{status:404});
    if(!access.has(request.headers.get('authorization')?.slice(7)??''))return error('unauthenticated',401);
    const lastBody=await request.text();const {action,input}=JSON.parse(lastBody);calls.push(action);
    if(flaky.delete(action))return error('implementation_unavailable',503);
    const view=(path:string)=>{const f=files.get(path)!;return {id:f.id,revision:f.revision,name:path.split('/').pop(),current_version_id:`v${f.revision}`};};
    const children=(at:string)=>{
      const names=new Set<string>();
      for(const p of [...folders,...[...files.keys()].flatMap(f=>{const parts=f.split('/');return parts.slice(2,-1).map((_,i)=>parts.slice(0,i+2+1).join('/'));})])if(p.startsWith(at+'/')&&p.split('/').length===at.split('/').length+1)names.add(p);
      return [...names].map(p=>({kind:'folder',path:p,folder:{name:p.split('/').pop()}}));
    };
    switch(action){
      case 'zo.kb.list':{
        if(!input.path&&homeHidden)return error('permission_denied',403);
        if(!input.path)return Response.json({result:{view:'home',entries:[{kind:'folder',path:'/shared',folder:{name:'shared'}},{kind:'folder',path:'/workspace',folder:{name:'workspace'}}],next_cursor:null}});
        if(!folders.has(input.path)&&!children(input.path).length)return error('resource_not_found',404);
        // Two pages, so the cursor is followed.
        const all=children(input.path),cursor=JSON.parse(lastBody).options?.query?.cursor??null;
        return Response.json({result:{view:'folder',entries:cursor?all.slice(1):all.slice(0,1),next_cursor:cursor||all.length<2?null:'next'}});
      }
      case 'zo.folder.create':{const path=`${input.parent_path}/${input.name}`;if(folders.has(path)||children(input.parent_path).some(e=>e.path===path))return error('conflict',409);folders.add(path);return Response.json({result:{id:`d${++serial}`,name:input.name,revision:1}});}
      case 'zo.workspace.get':if(workspaceHidden)return error('permission_denied',403);return Response.json({result:{id:input.workspace_id,display_name:'MyCloud'}});
      case 'zo.file.create':{
        if(input.upload_id){const u=uploads.get(input.upload_id)!;if(files.has(u.path))return error('conflict',409);files.set(u.path,{id:`f${++serial}`,revision:1,content:u.bytes!});return Response.json({result:view(u.path)});}
        if(!input.create_parent_folders||!input.parent_path.startsWith('/workspace'))return error('resource_not_found',404);
        if(racing>0){racing--;return error('conflict',409);}
        const path=`${input.parent_path}/${input.name}`;if(files.has(path))return error('conflict',409);
        files.set(path,{id:`f${++serial}`,revision:1,content:new TextEncoder().encode(input.content)});return Response.json({result:view(path)});
      }
      case 'zo.file.prepare_create':{const id=`u${++serial}`;uploads.set(id,{path:`${input.parent_path}/${input.name}`});return Response.json({result:{upload_id:id,upload_url:`http://127.0.0.1:${server.port}/upload/${id}`}});}
      case 'zo.file.update':{
        if(!canUpdate)return error('permission_denied',403);
        const found=find(input.file_id);if(!found)return error('resource_not_found',404);
        const [path,f]=found;if(input.expected_revision!==f.revision)return error('conflict',409);
        files.set(path,{...f,revision:f.revision+1,content:new TextEncoder().encode(input.content)});return Response.json({result:view(path)});
      }
      case 'zo.file.get_metadata':{const path=input.path??find(input.file_id)?.[0];return path&&files.has(path)?Response.json({result:view(path)}):error('resource_not_found',404);}
    }
    return error('unknown_action',404);
  }});
  return {server,files,calls,credentials,folders,
    origin:`http://127.0.0.1:${server.port}`,
    text:(path:string,base=BASE)=>new TextDecoder().decode(files.get(`${base}/${path}`)?.content),
    edit(path:string,text:string){const f=files.get(`${BASE}/${path}`)!;files.set(`${BASE}/${path}`,{...f,revision:f.revision+1,content:new TextEncoder().encode(text)});},
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
    const sync=new ZoSync(root,drafts,{secrets,config:{authOrigin:zo.origin,apiOrigin:zo.origin},sleep:async()=>{},timers:false});
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
  const again=new ZoSync(f.root,f.drafts,{secrets:f.secrets,config:{authOrigin:f.zo.origin,apiOrigin:f.zo.origin},sleep:async()=>{},timers:false});
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

  const sent=f.zo.calls.length;await f.sync.run();
  expect(f.zo.calls.length).toBe(sent);

  d=editVersion(d,d.versions[1].id,'Punchier still.');await f.store.save(d);await f.sync.run();
  expect(f.zo.calls.slice(sent)).toEqual(['zo.file.update','zo.file.update']);
  expect(f.zo.text(`${d.id}.draft/versions/v2.md`)).toBe('Punchier still.');
  expect(f.zo.files.get(`${BASE}/${d.id}.draft/versions/v2.md`)?.revision).toBe(2);
}));

test('sync only reads the drafts on this Mac, even when the copy in Zo was changed',()=>fixture(async f=>{
  let d=fresh();d=editVersion(d,d.versions[0].id,'Mine.');await f.store.save(d);
  await link(f);await f.sync.run();
  f.zo.edit(`${d.id}.draft/versions/v1.md`,'Edited in Zo.');
  d=editVersion(d,d.versions[0].id,'Mine, later.');await f.store.save(d);
  const before=await snapshot(f.drafts);
  await f.sync.run();
  expect(await snapshot(f.drafts)).toEqual(before);
  expect(f.zo.text(`${d.id}.draft/versions/v1.md`)).toBe('Mine, later.');
  expect(f.zo.files.get(`${BASE}/${d.id}.draft/versions/v1.md`)?.revision).toBe(3);
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
  expect(f.sync.status()).toMatchObject({state:'error',message:`This service account can’t save to ${BASE}. In Zo, let it edit that folder or give it Full access, then choose Save now.`});
  expect(await snapshot(f.drafts)).toEqual(before);
}));

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
