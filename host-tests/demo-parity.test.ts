import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {checkDemoParity} from '../scripts/demo-parity';
import {versionContents} from '../scripts/release-version';

test('app changes require demo review; release version stamps do not invalidate reviewed behavior',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-demo-parity-')),source=resolve(import.meta.dir,'..');
 try{
  for(const name of ['src','desktop','native','host-ui'])await cp(join(source,name),join(root,name),{recursive:true});
  await cp(join(source,'features.json'),join(root,'features.json'));await mkdir(join(root,'website/demo'),{recursive:true});await cp(join(source,'website/demo/coverage.json'),join(root,'website/demo/coverage.json'));
  const hash=await checkDemoParity(root,true);assert.equal(await checkDemoParity(root),hash);
  for(const [name,contents] of Object.entries(await versionContents(source,'0.2.0-alpha.77')))if(name==='features.json'||name==='desktop/updates.ts')await writeFile(join(root,name),contents);
  assert.equal(await checkDemoParity(root),hash);
  await writeFile(join(root,'src/new-feature.ts'),'export const newFeature = true;');await assert.rejects(checkDemoParity(root),/reviewed/);
  await checkDemoParity(root,true);await checkDemoParity(root);
  const catalog=JSON.parse(await readFile(join(root,'features.json'),'utf8'));catalog.features.push({...catalog.features[0],id:'new-feature'});await writeFile(join(root,'features.json'),JSON.stringify(catalog));
  await assert.rejects(checkDemoParity(root,true),/every current official feature/);
 }finally{await rm(root,{recursive:true,force:true});}
});
