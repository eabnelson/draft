import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {builderSandbox} from '../desktop/agents';

test('personal feature builders can read their workspace but cannot read Mac release signing files',{skip:process.platform!=='darwin'},async()=>{
 const signing=join(homedir(),'Library/Application Support/DraftSigning');await mkdir(signing,{recursive:true});
 const secretFolder=await mkdtemp(join(signing,'.permission-check-')),workspace=await mkdtemp(join(tmpdir(),'draft-permission-'));
 try{
  await writeFile(join(secretFolder,'probe'),'private signing material');await writeFile(join(workspace,'probe'),'candidate source');
  for(const [path,allowed] of [[join(workspace,'probe'),true],[join(secretFolder,'probe'),false]] as const){
   const child=Bun.spawn(['/usr/bin/sandbox-exec','-p',builderSandbox(workspace,join(workspace,'data')),'/bin/cat',path],{stdout:'pipe',stderr:'pipe'});
   const output=await new Response(child.stdout).text();const code=await child.exited;
   if(allowed){assert.equal(code,0);assert.equal(output,'candidate source');}else{assert.notEqual(code,0);assert.equal(output,'');}
  }
 }finally{await rm(workspace,{recursive:true,force:true});await rm(secretFolder,{recursive:true,force:true});}
});
