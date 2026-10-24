import {test,expect} from 'bun:test';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DocumentStore} from '../desktop/documents';
import {fresh,addCandidate,choose} from '../src/model';
import {validateCatalog,differences,likelyMatch} from '../desktop/catalog';
import {readJSON,atomicWrite,sourceHash,safeId,within,copySource} from '../desktop/files';
import {Updates,parseAgentResult} from '../desktop/updates';
import type {Catalog,HostState,Version} from '../desktop/types';
const catalog=await readJSON<Catalog>(join(import.meta.dir,'../features.json'));

test('local files preserve complete writing state across reopen and archiving',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-documents-'));try{
  const store=new DocumentStore(root);const initial=await store.load();let draft=initial.drafts[0];const variant=draft.variants[0];draft=choose(draft,variant.id,variant.candidates[0].id);draft.overflow='Keep this nearby';
  await store.save({active:draft.id,drafts:[draft]});const reopened=(await new DocumentStore(root).load()).drafts[0];expect(reopened.text).toBe(draft.text);expect(reopened.variants[0].active).toBe(draft.variants[0].active);expect(reopened.overflow).toBe(draft.overflow);
  const other=fresh();await store.save({active:other.id,drafts:[other],archived:[reopened]});expect((await store.load()).archived?.[0].text).toBe(draft.text);expect((await readFile(join(root,`${draft.id}.draft.json`),'utf8')).length).toBeGreaterThan(100);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('invalid saving cannot overwrite the last confirmed document library',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-invalid-'));try{const store=new DocumentStore(root);const before=await store.load();await expect(store.save({active:before.active,drafts:[{...before.drafts[0],version:99} as any]})).rejects.toThrow();expect((await store.load()).drafts[0].text).toBe(before.drafts[0].text);}finally{await rm(root,{recursive:true,force:true});}
});
test('catalog uses stable identities and detects user changes',()=>{
 expect(validateCatalog(catalog).features.some(f=>f.id==='writing')).toBe(true);
 expect(()=>validateCatalog({...catalog,features:[catalog.features[0],catalog.features[0]]})).toThrow();
 const official={...catalog,features:catalog.features.filter(f=>f.origin==='official')};
 const modified={...official,features:official.features.map((f,i)=>i?f:{...f,state:'removed' as const})};expect(differences(official,modified).length).toBe(1);expect(likelyMatch(catalog,'alternate wording')?.id).toBe('alternatives');
});
test('agent completion must carry a complete structured outcome',()=>{
 expect(parseAgentResult('{"outcome":"implemented","title":"Reading time","summary":"Added reading time.","featureId":"reading-time"}').featureId).toBe('reading-time');
 expect(()=>parseAgentResult('Done!')).toThrow();expect(()=>parseAgentResult('{"outcome":"implemented"}')).toThrow();
});
test('activation is explicit, verified, confirmed, and recoverable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-update-')),source=join(root,'official-source'),dist=join(root,'official-dist');await mkdir(source);await mkdir(dist);await atomicWrite(join(source,'file.ts'),'official');await atomicWrite(join(dist,'index.html'),'<div>Official</div>');
 const v:Version={id:'official',label:'Official',createdAt:new Date().toISOString(),source,dist,catalog,officialId:'official',sourceHash:await sourceHash(source)};
 const controller=new Updates(root,source,source,process.execPath);controller.state={schemaVersion:1,activeVersion:'official',officialVersion:'official',versions:[v],updates:[]};
 const personal={...v,id:'personal',label:'Personal',parentId:'official'};controller.state.versions.push(personal);
 controller.state.updates.push({id:'u1',kind:'add',request:'reading time',title:'Reading time',state:'ready',stage:'Update ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),baseVersion:'official',versionId:'personal'});
 expect(controller.active.id).toBe('official');await controller.apply('u1');expect(controller.active.id).toBe('personal');expect(controller.state.pendingActivation?.previous).toBe('official');
 controller.state.pendingActivation!.deadline=0;expect(await controller.recoverIfNeeded()).toBe(true);expect(controller.active.id).toBe('official');expect(controller.state.updates[0].state).toBe('failed');
 controller.state.updates[0].state='ready';await controller.apply('u1');await controller.confirm('personal');expect(controller.state.pendingActivation).toBeUndefined();expect(controller.state.updates[0].state).toBe('applied');
 await rm(root,{recursive:true,force:true});
});
test('changed candidates cannot be applied after verification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-changed-'));try{const source=join(root,'source'),dist=join(root,'dist');await mkdir(source);await mkdir(dist);await atomicWrite(join(source,'app.ts'),'original');await atomicWrite(join(dist,'index.html'),'app');const version:Version={id:'v',label:'v',source,dist,catalog,createdAt:new Date().toISOString(),officialId:'v',sourceHash:await sourceHash(source)};
 const host=new Updates(root,source,source,process.execPath);host.state={schemaVersion:1,activeVersion:'v',officialVersion:'v',versions:[version],updates:[{id:'u',kind:'reset',request:'',title:'reset',state:'ready',stage:'ready',baseVersion:'v',versionId:'v',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]};await atomicWrite(join(source,'app.ts'),'changed');await expect(host.apply('u')).rejects.toThrow('changed after verification');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('paths reject traversal outside their owned area',()=>{expect(()=>safeId('../documents')).toThrow();expect(within('/tmp/draft','/tmp/draft/app')).toBe(true);expect(within('/tmp/draft','/tmp/draft-other')).toBe(false);});

test('changed application assets cannot bypass the verified source gate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-assets-'));try{
  const source=join(root,'source'),dist=join(root,'dist');await mkdir(source);await mkdir(dist);
  await atomicWrite(join(source,'app.ts'),'original');await atomicWrite(join(dist,'index.html'),'checked');
  const version:Version={id:'v',label:'v',source,dist,catalog,createdAt:new Date().toISOString(),officialId:'v',sourceHash:await sourceHash(source),artifactHash:await sourceHash(dist)};
  const host=new Updates(root,source,source,process.execPath);host.state={schemaVersion:1,activeVersion:'v',officialVersion:'v',versions:[version],updates:[{id:'u',kind:'reset',request:'',title:'reset',state:'ready',stage:'ready',baseVersion:'v',versionId:'v',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]};
  await atomicWrite(join(dist,'index.html'),'modified');await expect(host.apply('u')).rejects.toThrow('application changed after verification');expect(host.state.pendingActivation).toBeUndefined();
 }finally{await rm(root,{recursive:true,force:true});}
});

test('discarding an older failure leaves the current preparation running',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-discard-'));try{
  const host=new Updates(root,root,root,process.execPath),controller=new AbortController();
  Object.assign(host,{controller,runningId:'current'});
  host.state={schemaVersion:1,activeVersion:'v',officialVersion:'v',versions:[],updates:[{id:'older',kind:'add',request:'',title:'old',state:'failed',stage:'failed',baseVersion:'v',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]};
  await host.discard('older');expect(controller.signal.aborted).toBe(false);expect(host.state.updates[0].state).toBe('cancelled');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('generated native build files do not invalidate a clean working copy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-generated-'));try{
  const source=join(root,'original'),copy=join(root,'copy');
  await atomicWrite(join(source,'src-tauri','host.rs'),'trusted source');
  await atomicWrite(join(source,'src-tauri','gen','schema.json'),'generated metadata');
  await atomicWrite(join(source,'src-tauri','binaries','build-helper'),'generated binary');
  await atomicWrite(join(source,'src-tauri','.DS_Store'),'Finder metadata');
  await copySource(source,copy);
  expect(await sourceHash(join(source,'src-tauri'))).toBe(await sourceHash(join(copy,'src-tauri')));
 }finally{await rm(root,{recursive:true,force:true});}
});
