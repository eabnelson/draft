import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {atomicWrite} from '../desktop/files';
import {prepareOfficialMerge} from '../desktop/official-merge';
import type {Catalog} from '../desktop/types';

test('an official update keeps independent custom code and personal removals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-merge-'));const base=join(root,'base'),mine=join(root,'mine'),next=join(root,'next'),candidate=join(root,'candidate');
 const catalog:Catalog={schemaVersion:1,name:'Draft',appVersion:'1.0.0',features:[{id:'writing',title:'Writing',description:'Write.',origin:'official',state:'active',updatedAt:'2026-10-24T00:00:00Z',code:['src/app.ts']},{id:'overflow',title:'Overflow',description:'Keep notes.',origin:'official',state:'active',updatedAt:'2026-10-24T00:00:00Z',code:['src/overflow.ts']}]};
 const custom={...structuredClone(catalog),features:[catalog.features[0],{...catalog.features[1],state:'removed' as const},{id:'reading',title:'Reading time',description:'Show reading time.',origin:'personal' as const,state:'active' as const,updatedAt:'2026-10-26T00:00:00Z',code:['src/reading.ts']}]};
 const official={...structuredClone(catalog),appVersion:'1.1.0',features:[{...catalog.features[0],description:'Write and spellcheck.',updatedAt:'2026-10-27T00:00:00Z'},catalog.features[1]]};
 try{
  for(const [folder,value] of [[base,catalog],[mine,custom],[next,official]] as const)await atomicWrite(join(folder,'features.json'),JSON.stringify(value));
  for(const folder of [base,mine])await atomicWrite(join(folder,'src/app.ts'),'export const writing = true;\n');
  await atomicWrite(join(next,'src/app.ts'),'export const writing = true;\nexport const spelling = true;\n');
  for(const folder of [base,next])await atomicWrite(join(folder,'src/overflow.ts'),'export const overflow = true;\n');
  await atomicWrite(join(mine,'src/reading.ts'),'export const readingTime = true;\n');
  const result=await prepareOfficialMerge({base,mine,official:next,destination:candidate});
  assert.equal(result.conflicts.length,0);assert.equal(result.needsAgent,false);
  assert.equal(await readFile(join(candidate,'src/reading.ts'),'utf8'),'export const readingTime = true;\n');
  assert.match(await readFile(join(candidate,'src/app.ts'),'utf8'),/spelling = true/);
  assert.equal(result.catalog.features.find(f=>f.id==='overflow')?.state,'removed');
  assert.equal(result.catalog.appVersion,'1.1.0');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a conflicting custom feature can be kept for combining or replaced without losing other custom features',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-conflict-')),base=join(root,'base'),mine=join(root,'mine'),next=join(root,'next'),destination=join(root,'candidate');
 const writing={id:'writing',title:'Writing',description:'Write.',origin:'official' as const,state:'active' as const,updatedAt:'2026-10-24T00:00:00Z',code:['src/app.ts']};
 const catalog:Catalog={schemaVersion:1,name:'Draft',appVersion:'1.0.0',features:[writing]};
 const theme={id:'appearance',title:'My theme',description:'Use my dark theme.',origin:'personal' as const,state:'active' as const,updatedAt:'2026-10-26T00:00:00Z',code:['src/app.ts','src/theme.ts','tests/theme.test.ts']};
 const reading={id:'reading',title:'Reading time',description:'Show reading time.',origin:'personal' as const,state:'active' as const,updatedAt:theme.updatedAt,code:['src/reading.ts']};
 try{
  for(const [folder,value] of [[base,catalog],[mine,{...catalog,features:[writing,theme,reading]}],[next,{...catalog,appVersion:'1.1.0',features:[{...writing,description:'A new writing page.',updatedAt:'2026-10-27T00:00:00Z'}]}]] as const)await atomicWrite(join(folder,'features.json'),JSON.stringify(value));
  await atomicWrite(join(base,'src/app.ts'),'export const theme = "plain";\n');
  await atomicWrite(join(mine,'src/app.ts'),'export const theme = "dark";\n');
  await atomicWrite(join(next,'src/app.ts'),'export const theme = "light";\nexport const spelling = true;\n');
  await atomicWrite(join(mine,'src/theme.ts'),'export const dark = true;');await atomicWrite(join(mine,'tests/theme.test.ts'),'test the personal theme');
  await atomicWrite(join(mine,'src/reading.ts'),'export const minutes = 3;');
  const input={base,mine,official:next,destination};
  const preview=await prepareOfficialMerge(input);assert.equal(preview.conflicts[0]?.title,'My theme');
  const kept=await prepareOfficialMerge({...input,choices:{appearance:'keep-mine'}});assert.equal(kept.needsAgent,true);assert.ok(kept.preserved.includes('appearance'));
  const replaced=await prepareOfficialMerge({...input,choices:{appearance:'use-official'}});assert.equal(replaced.needsAgent,false);assert.ok(!replaced.catalog.features.some(f=>f.id==='appearance'));
  assert.match(await readFile(join(destination,'src/app.ts'),'utf8'),/spelling = true/);
  assert.equal(await readFile(join(destination,'src/reading.ts'),'utf8'),'export const minutes = 3;');
  await assert.rejects(readFile(join(destination,'src/theme.ts')));
  await assert.rejects(readFile(join(destination,'tests/theme.test.ts')));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('new official dependencies ask before restoring a feature the writer removed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-dependency-')),base=join(root,'base'),mine=join(root,'mine'),official=join(root,'official'),destination=join(root,'candidate');
 const overflow={id:'overflow',title:'Overflow',description:'Keep notes.',origin:'official' as const,state:'active' as const,updatedAt:'2026-10-24T00:00:00Z',code:['src/overflow.ts']};
 const catalog:Catalog={schemaVersion:1,name:'Draft',appVersion:'1.0.0',features:[overflow]};
 try{
  for(const [folder,value] of [[base,catalog],[mine,{...catalog,features:[{...overflow,state:'removed'}]}],[official,{...catalog,appVersion:'1.1.0',features:[overflow,{...overflow,id:'search',title:'Search',description:'Search your notes.',dependsOn:['overflow']}]}]] as const)await atomicWrite(join(folder,'features.json'),JSON.stringify(value));
  const input={base,mine,official,destination};const preview=await prepareOfficialMerge(input);assert.equal(preview.conflicts[0]?.id,'overflow');
  const keep=await prepareOfficialMerge({...input,choices:{overflow:'keep-mine'}});assert.equal(keep.needsAgent,true);assert.equal(keep.catalog.features.find(feature=>feature.id==='overflow')?.state,'removed');
  const replace=await prepareOfficialMerge({...input,choices:{overflow:'use-official'}});assert.equal(replace.catalog.features.find(feature=>feature.id==='overflow')?.state,'active');
 }finally{await rm(root,{recursive:true,force:true});}
});
