import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Updates} from '../desktop/updates';
import {atomicWrite,readJSON,sourceHash} from '../desktop/files';
import {DocumentStore} from '../desktop/documents';
import type {Catalog,Update,Version} from '../desktop/types';
const baseline:Catalog={schemaVersion:1,appVersion:'1.0.0',name:'Draft',features:[{id:'writing',title:'Writing',description:'Write locally.',updatedAt:'2026-10-24T16:00:00Z',origin:'official',state:'active'}]};

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'draft-handoff-')),template=join(root,'template'),data=join(root,'data'),dependencies=join(root,'dependencies');
  for(const folder of ['src','dist','desktop','scripts','src-tauri'])await mkdir(join(template,folder),{recursive:true});
  await mkdir(dependencies);await atomicWrite(join(template,'src/feature.ts'),'original');await atomicWrite(join(template,'dist/index.html'),'official');
  for(const folder of ['desktop','scripts','src-tauri'])await atomicWrite(join(template,folder,'host.txt'),'trusted controller');
  await atomicWrite(join(template,'features.json'),JSON.stringify(baseline));
  const host=new Updates(data,template,dependencies,process.execPath);Object.assign(host,{builds:join(root,'Builds')});await host.initialize();
  const docs=new DocumentStore(join(data,'Documents')),library=await docs.load();library.drafts[0].text='Private writing stays here';library.drafts[0].variants=[];await docs.save(library);
  return {root,template,data,dependencies,host,docs};
}
function request(host:Updates,state:Update['state']='failed',featureId?:string){const now=new Date().toISOString();const update:Update={id:crypto.randomUUID(),kind:'add',request:'Add reading time beside the word count.',featureId,title:'Reading time',state,stage:'Technical detail not for the update screen',createdAt:now,updatedAt:now,baseVersion:host.active.id,error:state==='failed'?'TypeScript diagnostic: missing a declaration':undefined};host.state.updates.push(update);return update;}
async function settled(host:Updates,id:string){for(let n=0;n<200;n++){const update=host.state.updates.find(u=>u.id===id)!;if(['ready','failed','cancelled'].includes(update.state)){await Bun.sleep(5);return update;}await Bun.sleep(5);}throw Error('Update did not settle.');}
async function addFeature(workspace:string){const catalog=await readJSON<Catalog>(join(workspace,'features.json'));catalog.features.push({id:'reading-time',title:'Reading time',description:'See how long your draft takes to read.',origin:'personal',state:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await atomicWrite(join(workspace,'features.json'),JSON.stringify(catalog));await atomicWrite(join(workspace,'src/feature.ts'),'finished feature');}

test('prompt retains the real feature context and creates an editable copy without exposing writing',async()=>{
 const f=await fixture();try{
  const original=request(f.host),before=await sourceHash(f.host.active.source),handoff=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0];
  expect(handoff.prompt).toContain(original.request);expect(handoff.prompt).toContain(record.workspace);expect(handoff.prompt).toContain(original.error!);expect(handoff.prompt).toContain('First ask me what I would like to change');expect(handoff.prompt).toContain('Check my changes');expect(handoff.prompt).not.toContain('Private writing stays here');
  await atomicWrite(join(record.workspace,'src/feature.ts'),'my iteration');expect(await sourceHash(f.host.active.source)).toBe(before);
  const again=await f.host.handoff({updateId:original.id});expect(again.id).toBe(handoff.id);expect(await readFile(join(record.workspace,'src/feature.ts'),'utf8')).toBe('my iteration');
  const reopened=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(reopened,{builds:f.host.builds});await reopened.initialize();expect(reopened.state.handoffs![0].id).toBe(handoff.id);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('external work becomes a separate verified update and preserves the document through activation',async()=>{
 const f=await fixture();try{
  const original=request(f.host),handoff=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0],active=f.host.active.id;
  await addFeature(record.workspace);
  Object.assign(f.host,{buildCandidate:async(workspace:string)=>{expect(workspace).not.toBe(record.workspace);expect(await readFile(join(workspace,'src/feature.ts'),'utf8')).toBe('finished feature');await mkdir(join(workspace,'dist'));await atomicWrite(join(workspace,'dist/index.html'),'checked app');return [{name:'Internal test details',passed:true}];}});
  const update=await f.host.checkHandoff(handoff.id),ready=await settled(f.host,update.id);expect(ready.state).toBe('ready');expect(ready.featureId).toBe('reading-time');expect(f.host.active.id).toBe(active);
  await f.host.apply(update.id);await f.host.confirm(f.host.active.id);expect(f.host.active.catalog.features.at(-1)?.id).toBe('reading-time');expect((await f.docs.load()).drafts[0].text).toBe('Private writing stays here');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('failed external checks retain both editable work and the previously ready update',async()=>{
 const f=await fixture();try{
  const original=request(f.host,'ready','reading-time'),handoff=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0];await addFeature(record.workspace);
  Object.assign(f.host,{buildCandidate:async()=>{throw Error('TypeScript check failed: fix the returned value');}});
  const update=await f.host.checkHandoff(handoff.id),failed=await settled(f.host,update.id);expect(failed.state).toBe('failed');expect(original.state).toBe('ready');expect(await readFile(join(record.workspace,'src/feature.ts'),'utf8')).toBe('finished feature');
  const prompt=await f.host.handoff({updateId:original.id});expect(prompt.prompt).toContain('fix the returned value');expect(f.host.active.id).toBe(original.baseVersion);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('a stale handoff cannot replace a newer app and a fresh prompt points to the preserved work',async()=>{
 const f=await fixture();try{
  const original=request(f.host),first=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0];await atomicWrite(join(record.workspace,'src/feature.ts'),'unfinished work');
  const newer={...f.host.active,id:'newer-version'};f.host.state.versions.push(newer);f.host.state.activeVersion=newer.id;
  await expect(f.host.checkHandoff(first.id)).rejects.toThrow('fresh prompt');expect(f.host.active.id).toBe(newer.id);
  const next=await f.host.handoff({updateId:original.id});expect(next.id).not.toBe(first.id);expect(next.prompt).toContain(record.workspace);expect(await readFile(join(record.workspace,'src/feature.ts'),'utf8')).toBe('unfinished work');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('handoffs are unavailable while the coding agent is still editing',async()=>{
 const f=await fixture();try{const original=request(f.host,'preparing');await expect(f.host.handoff({updateId:original.id})).rejects.toThrow('finish');expect(f.host.state.handoffs).toBeUndefined();}finally{await rm(f.root,{recursive:true,force:true});}
});
test('a packaged update is offered explicitly and preserves the old version and documents',async()=>{
 const f=await fixture();try{
  const old=f.host.active.id,catalog=await readJSON<Catalog>(join(f.template,'features.json'));catalog.appVersion='9.0.0';await atomicWrite(join(f.template,'features.json'),JSON.stringify(catalog));
  const host=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(host,{builds:f.host.builds});await host.initialize();expect(host.active.id).toBe(old);const update=host.state.updates.find(u=>u.state==='ready')!;expect(update.kind).toBe('official');
  await host.apply(update.id);await host.confirm(host.active.id);expect(host.active.catalog.appVersion).toBe('9.0.0');expect(host.state.versions.some(v=>v.id===old)).toBe(true);expect((await f.docs.load()).drafts[0].text).toBe('Private writing stays here');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('a packaged update does not replace edited source automatically',async()=>{
 const f=await fixture();try{
  await atomicWrite(join(f.host.active.source,'src/feature.ts'),'personal source edit');const catalog=await readJSON<Catalog>(join(f.template,'features.json'));catalog.appVersion='9.0.0';await atomicWrite(join(f.template,'features.json'),JSON.stringify(catalog));
  const host=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(host,{builds:f.host.builds});await host.initialize();expect(host.state.updates.some(u=>u.state==='ready')).toBe(false);expect(await readFile(join(host.active.source,'src/feature.ts'),'utf8')).toBe('personal source edit');expect(host.view().latestOfficial?.tag).toBe('v9.0.0');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('an applied feature handoff starts from the current app rather than an older feature snapshot',async()=>{
 const f=await fixture();try{
  const original=request(f.host,'applied','reading-time'),old=join(f.root,'older-source');await cp(f.host.active.source,old,{recursive:true});await atomicWrite(join(old,'src/feature.ts'),'outdated feature snapshot');
  f.host.state.versions.push({...f.host.active,id:'older-personal',source:old});original.versionId='older-personal';await atomicWrite(join(f.host.active.source,'src/feature.ts'),'current app with later features');
  await f.host.handoff({featureId:'reading-time'});expect(await readFile(join(f.host.state.handoffs![0].workspace,'src/feature.ts'),'utf8')).toBe('current app with later features');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('a changed desktop controller requires a fresh working copy while retaining earlier work',async()=>{
 const f=await fixture();try{
  const original=request(f.host),first=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0];record.hostVersion='older-host';
  await expect(f.host.checkHandoff(first.id)).rejects.toThrow('fresh prompt');const next=await f.host.handoff({updateId:original.id});expect(next.id).not.toBe(first.id);expect(next.prompt).toContain(record.workspace);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('external work cannot replace the desktop controller through a normal feature update',async()=>{
 const f=await fixture();try{
  const original=request(f.host),handoff=await f.host.handoff({updateId:original.id}),record=f.host.state.handoffs![0];await atomicWrite(join(record.workspace,'desktop/host.txt'),'changed controller');
  const update=await f.host.checkHandoff(handoff.id),failed=await settled(f.host,update.id);expect(failed.state).toBe('failed');expect(failed.error).toContain('native host');expect(f.host.active.id).toBe(original.baseVersion);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('an older package never offers to replace a newer official app',async()=>{
 const f=await fixture();try{
  const catalog=await readJSON<Catalog>(join(f.template,'features.json'));catalog.appVersion='0.9.0';await atomicWrite(join(f.template,'features.json'),JSON.stringify(catalog));
  const host=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(host,{builds:f.host.builds});await host.initialize();expect(host.active.id).toBe(f.host.active.id);expect(host.state.updates.some(u=>u.state==='ready')).toBe(false);expect(host.view().latestOfficial).toBeUndefined();
 }finally{await rm(f.root,{recursive:true,force:true});}
});
