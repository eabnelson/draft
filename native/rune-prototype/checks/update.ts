// Full native personal-update gate with a deterministic local editor, no model call.
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {copySource,readJSON} from '../../../desktop/files';
import {Updates,type AgentConnection} from '../../../desktop/updates';
import type {Catalog} from '../../../desktop/types';
const root=resolve(import.meta.dir,'../../..'),temporary=await mkdtemp(join(tmpdir(),'draft-native-update-'));
try{
  const template=join(temporary,'template'),profile=join(temporary,'profile');
  await copySource(root,template);await cp(join(root,'dist'),join(template,'dist'),{recursive:true});
  const agents:AgentConnection={
    discover:async()=>[{id:'codex',name:'Local check',installed:true,ready:true,models:[{id:'check',name:'Local check',provider:'codex'}]}],
    select:async()=>({provider:'codex',model:'check'}),login:async()=>[],
    run:async(_selection,_prompt,options)=>{
      const workspace=options!.workspace!,catalog=await readJSON<Catalog>(join(workspace,'features.json'));
      catalog.features=catalog.features.filter(feature=>feature.id!=='native-check-title');
      if(_prompt.includes('independent checks failed'))console.log(_prompt.slice(-4000));
      catalog.features.push({id:'native-check-title',title:'Native check title',description:'Changes the native window title.',origin:'personal',state:'active',updatedAt:new Date().toISOString(),code:['native/rune-prototype/src/ui.rs']});
      await writeFile(join(workspace,'features.json'),JSON.stringify(catalog));
      const file=join(workspace,'native/rune-prototype/src/ui.rs');
      await writeFile(file,(await readFile(file,'utf8')).replace('AppSpec::new("Draft",','AppSpec::new("Draft update check",'));
      return JSON.stringify({outcome:'implemented',title:'Native check title',summary:'Changed the native window title.',featureId:'native-check-title'});
    },
  };
  const updates=new Updates(profile,template,join(root,'node_modules'),process.execPath,{nativeRenderer:true,agents,builds:join(temporary,'builds')});
  await updates.initialize();const original=updates.active.id;
  const update=await updates.request('add','Change the native window title for this check.');
  const timeout=Date.now()+20*60*1000;
  while(!['ready','failed','needs-attention'].includes(update.state)&&Date.now()<timeout)await Bun.sleep(500);
  assert.equal(update.state,'ready',update.error??'Native preparation timed out');
  assert.ok(update.checks?.some(check=>check.name.startsWith('Native format')&&check.passed));
  await updates.apply(update.id,true);assert.notEqual(updates.active.id,original);
  await updates.abortActivation();assert.equal(updates.active.id,original);
  console.log('PASS native feature source edit, protected host, offline Rust checks/build, verified activation, and rollback');
}finally{await rm(temporary,{recursive:true,force:true});}
