import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ZoAuth,ZO_CLIENT_ID,SignInNeeded} from '../desktop/zo-auth';
import {ZoSync,type Secrets} from '../desktop/zo-sync';
import {DraftStore} from '../desktop/documents';

class MemorySecrets implements Secrets{
  values=new Map<string,string>();
  async get(key:string){return this.values.get(key)??null;}
  async set(key:string,value:string){this.values.set(key,value);}
  async delete(key:string){this.values.delete(key);}
}
async function fixture(run:(f:{root:string;secrets:MemorySecrets;auth:ZoAuth;sync:ZoSync;origin:string;login:()=>Promise<URL>;get:()=>{refreshes:number;revoked:boolean;revokedBy:string;headers:string[]};failRefresh:()=>void;expire:()=>void})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'draft-oauth-')),secrets=new MemorySecrets();
  let refreshes=0,revoked=false,revokedBy='',short=false,fail=false,challenge='',redirect='',serial=0;const headers:string[]=[];
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const url=new URL(request.url);
    if(url.pathname.endsWith('/oauth/token')){
      const form=new URLSearchParams(await request.text());
      expect(form.get('client_id')).toBe(ZO_CLIENT_ID);expect(form.get('resource')).toBe(`${origin}/zo-system-api`);
      if(form.get('grant_type')==='authorization_code'){
        expect(form.get('code')).toBe('once');expect(form.get('redirect_uri')).toBe(redirect);
        expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge);
      }else{expect(form.get('grant_type')).toBe('refresh_token');refreshes++;if(fail)return Response.json({error:'temporarily_unavailable'},{status:503});}
      return Response.json({access_token:`access-${++serial}`,refresh_token:`refresh-${serial}`,expires_in:short?1:300});
    }
    if(url.pathname.endsWith('/oauth/revoke')){revoked=true;revokedBy=new URLSearchParams(await request.text()).get('client_id')??'';return new Response(null,{status:200});}
    if(url.pathname.endsWith('/session'))return Response.json({workspaces:[{workspace_id:'wsp_a',name:'Studio',subject:{type:'service_account',id:'draft'}},{workspace_id:'wsp_b',name:'Personal',subject:{type:'user',id:'me'}}]});
    if(url.pathname.endsWith('/invoke')){headers.push(request.headers.get('Zo-Workspace-Id')??'');return Response.json({result:{entries:[],next_cursor:null}});}
    return new Response(null,{status:404});
  }});
  const origin=`http://127.0.0.1:${server.port}`,config={authOrigin:origin,apiOrigin:origin};
  const auth=new ZoAuth(root,secrets,'test',config,fetch),store=new DraftStore(join(root,'Drafts'));
  const sync=new ZoSync(root,store,{secrets,config,timers:false});
  async function login(){
    let url!:URL;await sync.signIn(async value=>{url=new URL(value);});
    challenge=url.searchParams.get('code_challenge')!;redirect=url.searchParams.get('redirect_uri')!;return url;
  }
  try{await run({root,secrets,auth,sync,origin,login,get:()=>({refreshes,revoked,revokedBy,headers}),failRefresh:()=>{fail=true;},expire:()=>{short=true;}});}
  finally{auth.cancel();await sync.disconnect().catch(()=>{});server.stop(true);await rm(root,{recursive:true,force:true});}
}
function callback(url:URL,issuer:string,fields:Record<string,string>={}){
  const result=new URL(url.searchParams.get('redirect_uri')!);
  result.search=new URLSearchParams({code:'once',state:url.searchParams.get('state')!,iss:issuer,...fields}).toString();return result;
}

test('browser PKCE sign-in exposes workspaces, waits for selection, and sends the selected workspace',()=>fixture(async f=>{
  const url=await f.login();expect(f.sync.status().state).toBe('signing-in');
  expect((await fetch(callback(url,f.origin))).ok).toBe(true);
  expect(f.sync.status().state).toBe('choose-workspace');
  const state=await readFile(join(f.root,'zo-auth.json'),'utf8');expect(state).not.toContain('refresh-');
  expect((await f.sync.workspaces()).map(w=>w.name)).toEqual(['Studio','Personal']);
  await expect(f.sync.chooseWorkspace('other')).rejects.toThrow('approved');
  expect(await f.sync.chooseWorkspace('wsp_b')).toMatchObject({state:'choose-folder',workspace:'Personal'});
  await f.sync.folders();expect(f.get().headers).toEqual(['wsp_b']);
  const disk=await readFile(join(f.root,'zo-sync.json'),'utf8');expect(disk).not.toContain('access-');expect(disk).not.toContain('refresh-');
  const again=new ZoSync(f.root,new DraftStore(join(f.root,'Drafts')),{secrets:f.secrets,config:{authOrigin:f.origin,apiOrigin:f.origin},timers:false});
  await again.initialize();expect(again.status()).toMatchObject({state:'choose-folder',workspace:'Personal'});
  await f.sync.disconnect();expect(f.get().revoked).toBe(true);expect(f.secrets.values.size).toBe(0);expect(f.sync.status().state).toBe('off');
}));

test('callback refuses wrong state or issuer without consuming the valid response',()=>fixture(async f=>{
  const url=await f.login();
  expect((await fetch(callback(url,f.origin,{state:'wrong'}))).status).toBe(400);
  expect((await fetch(callback(url,'https://wrong.example'))).status).toBe(400);
  expect(f.secrets.values.size).toBe(0);expect(f.sync.status().state).toBe('signing-in');
  expect((await fetch(callback(url,f.origin))).ok).toBe(true);expect(f.sync.status().state).toBe('choose-workspace');
}));

test('denied consent leaves drafts untouched and lets the person try again',()=>fixture(async f=>{
  const url=await f.login();
  expect((await fetch(callback(url,f.origin,{error:'access_denied'}))).status).toBe(400);
  expect(f.sync.status()).toMatchObject({state:'needs-credentials'});expect(f.secrets.values.size).toBe(0);
  const again=await f.login();expect((await fetch(callback(again,f.origin))).ok).toBe(true);
}));

test('concurrent refreshes share a rotation and an interrupted rotation cannot replay later',()=>fixture(async f=>{
  f.expire();
  const auth=f.auth;
  const url=await f.login();await fetch(callback(url,f.origin));
  const refresh=[...f.secrets.values.values()][0];await f.secrets.set('test-oauth',refresh);
  await auth.initialize();
  expect(await Promise.all([auth.token(),auth.token(),auth.token()])).toEqual(['access-2','access-2','access-2']);
  expect(f.get().refreshes).toBe(1);
  auth.invalidate();f.failRefresh();
  await expect(auth.token()).rejects.toThrow('unavailable');expect(f.get().refreshes).toBe(3);
  const again=new ZoAuth(f.root,f.secrets,'test',{authOrigin:f.origin,apiOrigin:f.origin},fetch);await again.initialize();
  await expect(again.token()).rejects.toBeInstanceOf(SignInNeeded);expect(f.get().refreshes).toBe(3);
}));

test('a cancelled callback cannot restore a disconnected connection',()=>fixture(async f=>{
  const url=await f.login();await f.sync.disconnect();
  await fetch(callback(url,f.origin)).catch(()=>{});
  expect(f.sync.status().state).toBe('off');expect(f.secrets.values.size).toBe(0);
}));

test('the published metadata document names Draft and the callback it signs in with',async()=>{
  const doc=JSON.parse(await readFile(join(import.meta.dir,'../website/oauth/client-metadata.json'),'utf8'));
  expect(doc).toMatchObject({client_id:ZO_CLIENT_ID,client_name:'Draft',token_endpoint_auth_method:'none'});
  expect(doc.grant_types).toEqual(['authorization_code','refresh_token']);
  const url=new URL(ZO_CLIENT_ID);expect(url.protocol).toBe('https:');
  expect(doc.redirect_uris).toContain('http://127.0.0.1/callback');expect(doc).not.toHaveProperty('client_secret');
});

test('a sign-in under the old client ID is never refreshed and is revoked under that ID on the next sign-in',()=>fixture(async f=>{
  await writeFile(join(f.root,'zo-auth.json'),JSON.stringify({clientId:'draft-desktop'})+'\n');
  await writeFile(join(f.root,'zo-sync.json'),JSON.stringify({schemaVersion:3,auth:'oauth',clientId:'draft-desktop',workspaceId:'wsp_a',workspaceName:'Studio',base:'/workspace/Draft',files:{}})+'\n');
  const auth=new ZoAuth(f.root,f.secrets,'test',{authOrigin:f.origin,apiOrigin:f.origin},fetch);
  await f.secrets.set('test-oauth','old-refresh');await auth.initialize();
  expect(auth.enabled).toBe(false);expect(auth.legacy).toBe(true);
  await expect(auth.token()).rejects.toBeInstanceOf(SignInNeeded);expect(f.get().refreshes).toBe(0);
  await f.secrets.set(`client-${createHash('sha256').update(f.root).digest('hex').slice(0,16)}-oauth`,'old-refresh');
  await f.sync.initialize();
  const url=await f.login();expect(f.get().revokedBy).toBe('draft-desktop');
  expect((await fetch(callback(url,f.origin))).ok).toBe(true);expect(f.sync.status().state).toBe('choose-workspace');
  expect(JSON.parse(await readFile(join(f.root,'zo-auth.json'),'utf8'))).toEqual({clientId:ZO_CLIENT_ID});
}));
