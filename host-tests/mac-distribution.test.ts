import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {signBundledCode,requireDeveloperIdCode} from '../scripts/mac-distribution';

test('public distribution rejects ad-hoc code even when its signature is valid',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-signing-'));
 try{
  await cp('/usr/bin/true',join(root,'helper'));await mkdir(join(root,'vendor'));await writeFile(join(root,'vendor/source.js'),'export const untouched = true;');
  const before=await Bun.file(join(root,'vendor/source.js')).text();
  const signed=await signBundledCode(root,'-');assert.ok(signed.includes(join(root,'helper')));
  const child=Bun.spawn(['/usr/bin/codesign','--verify','--strict',join(root,'helper')],{stderr:'pipe'});assert.equal(await child.exited,0,await new Response(child.stderr).text());
  await assert.rejects(requireDeveloperIdCode(join(root,'helper'),'9YCNUWK84C'),/Developer ID/);
  assert.equal(await Bun.file(join(root,'vendor/source.js')).text(),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
