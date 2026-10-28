import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {officialFixture,settled} from './helpers/official-update';
import {readClaudeResult} from '../desktop/agents';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';

test('a revoked Claude login preserves a personal feature request and identifies the sign-in recovery',async()=>{
 const f=await officialFixture({agent:async()=>{
  async function* revoked(){yield {type:'result',subtype:'success',is_error:true,result:'Failed to authenticate: OAuth token revoked. Please log in again or contact your administrator.'} as SDKMessage;}
  return readClaudeResult(revoked());
 }});try{
  await f.host.queue({action:'add',request:'command + F to trigger searching words in a draft'});
  const request=await f.host.request('batch','');const failed=await settled(f.host,request.id);
  assert.equal(failed.state,'failed');assert.equal(failed.reconnectProvider,'claude');
  assert.match(failed.error!,/Sign in to Claude Code again in Model settings/);
  assert.equal(f.host.view().activeVersion,'personal-start');assert.equal(f.host.view().featureQueue?.length,1);assert.equal(f.host.view().featureQueue?.[0].selected,true);
  assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
 }finally{await f.close();}
});

test('automatic discovery, download, real build, restart confirmation and undo preserve custom features and documents',{timeout:30000},async()=>{
 const f=await officialFixture();try{
  f.host.startAutomaticChecks();
  for(let i=0;i<100&&!f.host.view().latestOfficial;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.host.view().latestOfficial?.tag,'v1.1.0');
  const request=await f.host.request('official','Bring in the latest Draft and keep my changes.');
  const ready=await settled(f.host,request.id);assert.equal(ready.state,'ready',ready.error);
  assert.equal(f.host.view().activeVersion,'personal-start');
  await f.host.apply(ready.id);await f.host.confirm(f.host.view().activeVersion);
  const current=f.host.view().current;assert.equal(current.appVersion,'1.1.0');
  assert.deepEqual(current.features.filter(feature=>feature.origin==='personal').map(feature=>feature.id).sort(),['appearance','reading']);
  assert.ok(current.features.some(feature=>feature.id==='spelling'));assert.equal(f.host.view().latestOfficial,undefined);
  assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
  const source=f.host.view().sourcePath;assert.equal(await readFile(join(source,'src/appearance.ts'),'utf8'),'export const appearance = "dark";');
  const undo=await f.host.request('rollback','Undo the last update');const rollback=await settled(f.host,undo.id);assert.equal(rollback.state,'ready');
  await f.host.apply(rollback.id);await f.host.confirm(f.host.view().activeVersion);assert.equal(f.host.view().activeVersion,'personal-start');
  assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
 }finally{await f.close();}
});

test('choosing Draft’s version resolves one conflict and keeps the other personal feature', {timeout:30000},async()=>{
 const f=await officialFixture({conflict:true});try{
  await f.host.checkOfficial();const request=await f.host.request('official','');let update=await settled(f.host,request.id);
  assert.equal(update.state,'needs-attention');assert.equal(update.official?.conflicts[0]?.id,'appearance');
  await f.host.resolveOfficial(update.id,{appearance:'use-official'});update=await settled(f.host,update.id);assert.equal(update.state,'ready',update.error);
  await f.host.apply(update.id);await f.host.confirm(f.host.active.id);
  assert.ok(f.host.active.catalog.features.some(feature=>feature.id==='reading'));assert.ok(!f.host.active.catalog.features.some(feature=>feature.id==='appearance'));
  assert.match(await readFile(join(f.host.active.source,'src/main.ts'),'utf8'),/appearance="light"/);
  assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
 }finally{await f.close();}
});

test('keeping a conflict stops if the coding provider deletes the retained personal checks', {timeout:30000},async()=>{
 const {rm,writeFile}=await import('node:fs/promises');
 const f=await officialFixture({conflict:true,agent:async(_selection,_prompt,options)=>{
  const workspace=options!.workspace!;await writeFile(join(workspace,'src/main.ts'),'import {writing} from "./writing";document.body.textContent=writing;');
  await rm(join(workspace,'tests/appearance.test.ts'),{force:true});return JSON.stringify({outcome:'implemented',title:'Combined',summary:'Your changes are kept.'});
 }});try{
  await f.host.checkOfficial();const request=await f.host.request('official','');await settled(f.host,request.id);
  await f.host.resolveOfficial(request.id,{appearance:'keep-mine'});const update=await settled(f.host,request.id);
  assert.equal(update.state,'needs-attention');assert.equal(f.host.active.id,'personal-start');assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
 }finally{await f.close();}
});

test('missing model access leaves explicit choices waiting and cancellation keeps the current app', {timeout:30000},async()=>{
 const f=await officialFixture({conflict:true,noModel:true});try{
  await f.host.checkOfficial();const request=await f.host.request('official','');await settled(f.host,request.id);
  await f.host.resolveOfficial(request.id,{appearance:'keep-mine'});const waiting=await settled(f.host,request.id);assert.equal(waiting.state,'needs-attention');assert.equal(waiting.official?.needsModel,true);
  await f.host.discard(request.id);assert.equal(f.host.active.id,'personal-start');assert.equal(f.host.view().updates[0].state,'cancelled');
 }finally{await f.close();}
});

test('an interrupted native installation on the old host restores its source pointers', {timeout:30000},async()=>{
 const {Updates}=await import('../desktop/updates');const {atomicWrite}=await import('../desktop/files');
 const f=await officialFixture();try{
  await f.host.checkOfficial();const request=await f.host.request('official','');const ready=await settled(f.host,request.id);await f.host.apply(ready.id,true);
  const plan=join(f.data,'NativeUpdates',request.id,'install-plan.json');await atomicWrite(plan,JSON.stringify({targetHost:'1.2.0'}));f.host.state.nativeInstallPlan=plan;await atomicWrite(join(f.data,'state.json'),JSON.stringify(f.host.state));
  const reopened=new Updates(f.data,f.template,f.host.dependencies,process.execPath,{hostVersion:'1.1.0',builds:join(f.root,'reopened')});await reopened.initialize();
  assert.equal(reopened.active.id,'personal-start');assert.equal(reopened.state.pendingActivation,undefined);assert.equal(reopened.view().updates[0].state,'failed');assert.equal((await f.docs.load()).drafts[0].text,'My writing stays on this Mac.');
 }finally{await f.close();}
});
