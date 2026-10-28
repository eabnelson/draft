import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AgentSignInError} from '../desktop/agents';
import {Updates} from '../desktop/updates';
import type {Provider} from '../desktop/types';
import {officialFixture,settled} from './helpers/official-update';

const connected:Provider={id:'claude',name:'Claude Code',installed:true,ready:true,models:[{id:'fixture',name:'Claude',provider:'claude'}]};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(login?:()=>Promise<Provider[]>){
 let signedIn=false,loginCalls=0,requestId='';
 const f=await officialFixture({
  login:async provider=>{assert.equal(provider,'claude');loginCalls++;const providers=await (login?.()??Promise.resolve([connected]));signedIn=providers.some(p=>p.id==='claude'&&p.ready);return providers;},
  agent:async(_selection,_prompt,options)=>{
   if(!signedIn)throw new AgentSignInError('claude');
   const path=join(options!.workspace!,'features.json'),catalog=JSON.parse(await readFile(path,'utf8'));
   catalog.features.push({id:'find',title:'Find in draft',description:'Find words in your draft.',origin:'personal',state:'active',updatedAt:new Date().toISOString(),code:['src/find.ts']});
   await writeFile(path,JSON.stringify(catalog));await writeFile(join(options!.workspace!,'src/find.ts'),'export const find = (text:string, word:string) => text.indexOf(word);');
   return JSON.stringify({outcome:'implemented',title:'Find in draft',summary:'Find words in your draft.',features:[{requestId,featureId:'find',outcome:'implemented'}]});
  },
 });
 await f.host.queue({action:'add',request:'Find words with Command-F'});requestId=f.host.state.featureQueue![0].id;
 const requested=await f.host.request('batch',''),failed=await settled(f.host,requested.id);
 assert.equal(failed.state,'failed');assert.equal(failed.reconnectProvider,'claude');
 return {...f,failed,loginCalls:()=>loginCalls};
}

test('sign-in retries the queued feature, passes real builds and installs without losing writing or custom features',{timeout:30000},async()=>{
 const f=await fixture();try{
  const queued=structuredClone(f.host.state.featureQueue),result=await f.host.reconnect(f.failed.id);
  assert.equal(f.loginCalls(),1);assert.ok(result.update);assert.notEqual(result.update.id,f.failed.id);
  assert.deepEqual(f.host.state.featureQueue,queued);assert.ok(f.failed.reconnectedAt);
  const ready=await settled(f.host,result.update.id);assert.equal(ready.state,'ready',ready.error);
  assert.equal(f.host.active.id,'personal-start');assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
  await f.host.apply(ready.id);await f.host.confirm(f.host.active.id);
  assert.deepEqual(f.host.active.catalog.features.filter(f=>f.origin==='personal').map(f=>f.id).sort(),['appearance','find','reading']);
  assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');assert.equal(f.host.state.featureQueue?.length,0);
 }finally{await f.close();}
});

test('sign-in recovery shares a settings login while waiting for the failed preparation to finish saving',async()=>{
 const f=await officialFixture({agent:async()=>{throw new AgentSignInError('claude');},login:async()=>[connected]});
 const saving=deferred<void>(),entered=deferred<void>();let signIns=0;
 try{
  const save=(f.host as any).save.bind(f.host);
  (f.host as any).save=async()=>{if(f.host.state.updates.at(-1)?.state==='failed'){entered.resolve();await saving.promise;}await save();};
  f.host.agents.login=async()=>{signIns++;return [connected];};
  await f.host.queue({action:'add',request:'Find words with Command-F'});
  const failed=await f.host.request('batch','');await entered.promise;
  const recovery=f.host.reconnect(failed.id);let rejected=false;void recovery.catch(()=>{rejected=true;});
  const settings=f.host.login('claude');
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(rejected,false,'A visible sign-in failure must wait for its save instead of rejecting recovery.');assert.equal(f.host.state.updates.length,1);assert.equal(signIns,1);
  saving.resolve();const [result]=await Promise.all([recovery,settings]);assert.ok(result.update);await settled(f.host,result.update.id);assert.equal(signIns,1);
 }finally{saving.resolve();await f.close();}
});

test('duplicate sign-in clicks share one login and start at most one retry',{timeout:30000},async()=>{
 const login=deferred<Provider[]>(),f=await fixture(()=>login.promise);try{
  const first=f.host.reconnect(f.failed.id),second=f.host.reconnect(f.failed.id);login.resolve([connected]);
  const [a,b]=await Promise.all([first,second]);assert.equal(f.loginCalls(),1);assert.equal(a.update?.id,b.update?.id);
  assert.equal(f.host.state.updates.length,2);await settled(f.host,a.update!.id);
  await assert.rejects(f.host.reconnect(f.failed.id),/current|another|changed/i);assert.equal(f.loginCalls(),1);
 }finally{await f.close();}
});

test('Model settings and the recovery card share a sign-in that is already open',{timeout:30000},async()=>{
 const login=deferred<Provider[]>(),f=await fixture(()=>login.promise);try{
  const recovery=f.host.reconnect(f.failed.id),settings=f.host.login('claude');login.resolve([connected]);
  const [result]=await Promise.all([recovery,settings]);await settled(f.host,result.update!.id);assert.equal(f.loginCalls(),1);
 }finally{await f.close();}
});

test('a retry that still needs sign-in stops without an automatic login loop',async()=>{
 const f=await fixture();try{
  f.host.agents.run=async()=>{throw new AgentSignInError('claude');};
  const result=await f.host.reconnect(f.failed.id),failed=await settled(f.host,result.update!.id);
  assert.equal(failed.state,'failed');assert.equal(failed.reconnectProvider,'claude');assert.equal(failed.reconnectedAt,undefined);
  assert.equal(f.loginCalls(),1);assert.equal(f.host.state.updates.length,2);assert.equal(f.host.state.featureQueue?.length,1);
 }finally{await f.close();}
});

test('cancelled or incomplete sign-in leaves the failed update, queued idea and current app intact',async()=>{
 for(const login of [async():Promise<Provider[]>=>{throw Error('private provider output');},async()=>[{...connected,ready:false}]]){
  const f=await fixture(login);try{
   const queued=structuredClone(f.host.state.featureQueue);await assert.rejects(f.host.reconnect(f.failed.id),/Sign-in didn’t finish/);
   assert.equal(f.host.state.updates.length,1);assert.equal(f.failed.reconnectedAt,undefined);assert.deepEqual(f.host.state.featureQueue,queued);assert.equal(f.host.active.id,'personal-start');
  }finally{await f.close();}
 }
});

test('changing the selected ideas during sign-in reconnects without building an outdated request',async()=>{
 const login=deferred<Provider[]>(),f=await fixture(()=>login.promise);try{
  const pending=f.host.reconnect(f.failed.id);await f.host.queue({action:'add',request:'Also show reading goals'});login.resolve([connected]);
  const result=await pending;assert.equal(result.update,undefined);assert.match(result.message,/list changed/);assert.ok(f.failed.reconnectedAt);
  assert.equal(f.host.state.updates.length,1);assert.equal(f.host.state.featureQueue?.length,2);assert.equal(f.host.active.id,'personal-start');
 }finally{await f.close();}
});

test('another update or a model change during sign-in prevents an automatic retry',async()=>{
 for(const change of ['update','model'] as const){
  const login=deferred<Provider[]>(),f=await fixture(()=>login.promise);try{
   const pending=f.host.reconnect(f.failed.id);
   if(change==='update'){const reset=await f.host.request('reset','');await settled(f.host,reset.id);}
   else f.host.state.selection={provider:'codex',model:'another-model'};
   login.resolve([connected]);const result=await pending;
   assert.equal(result.update,undefined);assert.equal(f.host.state.updates.length,change==='update'?2:1);assert.equal(f.host.active.id,'personal-start');
  }finally{await f.close();}
 }
});

test('a changed app is rejected before sign-in and an unavailable model never starts a retry',async()=>{
 const f=await fixture();try{
  const reset=await f.host.request('reset','');await settled(f.host,reset.id);await f.host.apply(reset.id);await f.host.confirm(f.host.active.id);
  await assert.rejects(f.host.reconnect(f.failed.id),/changed|current/);assert.equal(f.loginCalls(),0);
 }finally{await f.close();}
 const unavailable=await fixture(async()=>[{...connected,models:[]}]);try{
  const result=await unavailable.host.reconnect(unavailable.failed.id);assert.equal(result.update,undefined);assert.match(result.message,/Choose a model/);assert.equal(unavailable.host.state.updates.length,1);
 }finally{await unavailable.close();}
});

test('Model settings retain a known sign-in failure across discovery and clear it after a direct or manual login',{timeout:30000},async()=>{
 for(const direct of [true,false]){
  const f=await fixture();try{
   // Discovery can report a locally saved account even though its login was revoked.
   f.host.agents.discover=async()=>[connected];
   assert.equal((await f.host.providers(true))[0].ready,false);
   if(direct){const result=await f.host.reconnect(f.failed.id);await settled(f.host,result.update!.id);}
   else {await f.host.discard(f.failed.id);assert.equal((await f.host.providers(true))[0].ready,false);await f.host.login('claude');}
   assert.equal((await f.host.providers(true))[0].ready,true);assert.ok(f.failed.reconnectedAt);
  }finally{await f.close();}
 }
});

test('reopening Draft keeps Sign-in needed until the connection has been restored',async()=>{
 const f=await fixture();try{
  const reopened=new Updates(f.data,f.template,f.host.dependencies,process.execPath,{hostVersion:f.host.hostVersion,builds:f.host.builds,agents:{...f.host.agents,discover:async()=>[connected]}});
  await reopened.initialize();assert.equal((await reopened.providers(true))[0].ready,false);
  await reopened.login('claude');assert.equal((await reopened.providers(true))[0].ready,true);
 }finally{await f.close();}
});
