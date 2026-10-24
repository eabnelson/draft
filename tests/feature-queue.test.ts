import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Updates} from '../desktop/updates';
import {atomicWrite,readJSON} from '../desktop/files';
import {validateFeatureResults,estimateSeconds,timeRemaining} from '../desktop/feature-queue';
import type {Catalog,FeatureResult,Update} from '../desktop/types';
const baseline:Catalog={schemaVersion:1,appVersion:'1.0.0',name:'Draft',features:[{id:'writing',title:'Writing',description:'Write.',origin:'official',state:'active',updatedAt:'2026-10-24T16:00:00Z'}]};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'draft-queue-')),template=join(root,'template'),data=join(root,'data'),dependencies=join(root,'dependencies');
 for(const folder of ['src','dist','desktop','scripts','src-tauri','docs'])await mkdir(join(template,folder),{recursive:true});await mkdir(dependencies);
 await atomicWrite(join(template,'features.json'),JSON.stringify(baseline));await atomicWrite(join(template,'dist/index.html'),'official');await atomicWrite(join(template,'docs/feature-builder.md'),'Build the full requested update.');
 const host=new Updates(data,template,dependencies,process.execPath);Object.assign(host,{builds:join(root,'Builds')});await host.initialize();
 Object.assign(host,{defaultSelection:async()=>({provider:'claude',model:'test'}),buildCandidate:async(workspace:string)=>{await mkdir(join(workspace,'dist'),{recursive:true});await atomicWrite(join(workspace,'dist/index.html'),'verified candidate');return [{name:'behavior',passed:true}];}});
 return {root,host,data,template,dependencies};
}
async function settle(host:Updates,id:string){for(let n=0;n<200;n++){const u=host.state.updates.find(u=>u.id===id)!;if(['ready','failed','cancelled','already-exists'].includes(u.state)){await Bun.sleep(5);return u;}await Bun.sleep(5);}throw Error('Did not finish');}
async function complete(workspace:string,requests:any[]){const catalog=await readJSON<Catalog>(join(workspace,'features.json'));const features:FeatureResult[]=requests.map((request,i)=>{const id=`custom-${i}`;catalog.features.push({id,title:request.request,description:'A working change.',origin:'personal',state:'active',updatedAt:new Date().toISOString()});return {requestId:request.id,featureId:id,outcome:'implemented'};});await atomicWrite(join(workspace,'features.json'),JSON.stringify(catalog));return JSON.stringify({outcome:'implemented',title:'Your update',summary:'Both changes are ready.',features});}

test('ideas persist without invoking AI; selection and order define one immutable download',async()=>{
 const f=await fixture();try{
  let calls=0;Object.assign(f.host.agents,{run:async(_s:any,prompt:string,options:any)=>{calls++;expect(prompt).toContain('Implement ALL');return complete(options.workspace,f.host.state.updates.at(-1)!.requests!);}});
  await f.host.queue({action:'add',request:'Reading time'});await f.host.queue({action:'add',request:'Focus mode'});await f.host.queue({action:'add',request:'Later idea'});
  const [a,b,c]=f.host.state.featureQueue!;await f.host.queue({action:'select',id:c.id,selected:false});await f.host.queue({action:'move',id:b.id,direction:-1});expect(calls).toBe(0);
  const disk=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(disk,{builds:f.host.builds});await disk.initialize();expect(disk.state.featureQueue!.map(q=>q.id)).toEqual([b.id,a.id,c.id]);
  const before=f.host.active.id,u=await f.host.request('batch','');await expect(f.host.queue({action:'remove',id:a.id})).rejects.toThrow('current download');
  await f.host.queue({action:'add',request:'An idea for next time'});expect((await settle(f.host,u.id)).state).toBe('ready');expect(calls).toBe(1);expect(u.requests!.map(q=>q.id)).toEqual([b.id,a.id]);
  expect(f.host.active.id).toBe(before);await f.host.apply(u.id,true);expect(f.host.state.featureQueue!.length).toBe(4);
  const restarted=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(restarted,{builds:f.host.builds});await restarted.initialize();expect(restarted.active.id).toBe(u.versionId!);expect(restarted.state.pendingActivation?.restartPending).toBeUndefined();
  await restarted.confirm(restarted.active.id);expect(restarted.state.featureQueue!.map(q=>q.request)).toEqual(['Later idea','An idea for next time']);expect(restarted.state.updates.at(-1)!.state).toBe('applied');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('incomplete results never become ready and retain the full wishlist',async()=>{
 const f=await fixture();try{
  await f.host.queue({action:'add',request:'Reading time'});await f.host.queue({action:'add',request:'Focus mode'});const active=f.host.active.id;
  Object.assign(f.host.agents,{run:async(_s:any,_p:string,o:any)=>complete(o.workspace,f.host.state.updates.at(-1)!.requests!.slice(0,1))});
  const u=await f.host.request('batch','');expect((await settle(f.host,u.id)).state).toBe('failed');expect(f.host.active.id).toBe(active);expect(f.host.state.featureQueue!.length).toBe(2);
  await f.host.discard(u.id);expect(f.host.state.featureQueue!.length).toBe(2);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('restart is allowed once; an unconfirmed second start restores the prior app and retains ideas',async()=>{
 const f=await fixture();try{
  await f.host.queue({action:'add',request:'Reading time'});Object.assign(f.host.agents,{run:async(_s:any,_p:string,o:any)=>complete(o.workspace,f.host.state.updates.at(-1)!.requests!)});
  const original=f.host.active.id,u=await f.host.request('batch','');await settle(f.host,u.id);await f.host.apply(u.id,true);
  const first=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(first,{builds:f.host.builds});await first.initialize();expect(first.active.id).toBe(u.versionId!);
  const second=new Updates(f.data,f.template,f.dependencies,process.execPath);Object.assign(second,{builds:f.host.builds});await second.initialize();expect(second.active.id).toBe(original);expect(second.state.featureQueue!.length).toBe(1);expect(second.state.updates.at(-1)!.state).toBe('failed');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('batch validation rejects duplicates, mismatched removals, and falsely existing features',()=>{
 const requests=[{id:'a',kind:'add' as const,request:'Reading',createdAt:'',selected:true},{id:'b',kind:'remove' as const,request:'Remove writing',featureId:'writing',createdAt:'',selected:true}];
 const catalog=structuredClone(baseline);catalog.features[0].state='removed';catalog.features.push({...baseline.features[0],id:'reading',state:'active'});
 const valid:FeatureResult[]=[{requestId:'a',featureId:'reading',outcome:'implemented'},{requestId:'b',featureId:'writing',outcome:'implemented'}];expect(()=>validateFeatureResults(requests,valid,catalog,baseline)).not.toThrow();
 expect(()=>validateFeatureResults(requests,[valid[0],valid[0]],catalog,baseline)).toThrow();expect(()=>validateFeatureResults(requests,[{...valid[0],outcome:'already_exists'},valid[1]],catalog,baseline)).toThrow();expect(()=>validateFeatureResults(requests,[valid[0],{...valid[1],featureId:'reading'}],catalog,baseline)).toThrow();
});

test('time estimates use preparation history, exclude user wait time, and admit overruns',()=>{
 const createdAt='2026-10-24T16:00:00Z',u={kind:'batch',state:'applied',createdAt,preparedAt:'2026-10-24T16:02:00Z',updatedAt:'2026-10-24T20:00:00Z',requests:[{}]} as Update;
 expect(estimateSeconds([u],2)).toBe(240);expect(estimateSeconds([],2)).toBe(300);expect(timeRemaining({...u,estimatedSeconds:120},Date.parse(createdAt)+60000)).toBe('About 1 min left');expect(timeRemaining({...u,estimatedSeconds:120},Date.parse(createdAt)+180000)).toBe('Taking a little longer…');
});

test('continued batch work accounts for every change and supersedes a ready update only after verification',async()=>{
 const f=await fixture();try{
  await f.host.queue({action:'add',request:'Reading time'});await f.host.queue({action:'add',request:'Focus mode'});Object.assign(f.host.agents,{run:async(_s:any,_p:string,o:any)=>complete(o.workspace,f.host.state.updates.at(-1)!.requests!)});
  const original=await f.host.request('batch','');await settle(f.host,original.id);const prompt=await f.host.handoff({updateId:original.id}),workspace=f.host.state.handoffs![0].workspace;
  expect(prompt.prompt).toContain('requestedChanges');expect(prompt.prompt).toContain('.draft-update.json');
  await atomicWrite(join(workspace,'.draft-update.json'),JSON.stringify({outcome:'failed',title:'Needs work',summary:'One feature is unfinished.',features:original.featureResults}));
  const failed=await f.host.checkHandoff(prompt.id);expect((await settle(f.host,failed.id)).state).toBe('failed');expect(original.state).toBe('ready');
  await atomicWrite(join(workspace,'.draft-update.json'),JSON.stringify({outcome:'implemented',title:'Both finished',summary:'Ready.',features:original.featureResults}));
  const next=await f.host.checkHandoff(prompt.id);expect((await settle(f.host,next.id)).state).toBe('ready');expect(original.state).toBe('cancelled');expect(next.featureResults!.length).toBe(2);expect(f.host.state.featureQueue!.length).toBe(2);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
