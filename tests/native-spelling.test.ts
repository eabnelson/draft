import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeSpelling} from '../desktop/spelling';
import {spellingText} from '../src/editor-spelling';

test('Markdown spelling keeps visible labels and UTF-16 offsets but skips code and link addresses',()=>{
  const text='😀 **recieve** [mesage](https://seperate.example) `mispelled`\n\n```js\nrecieve()\n```\n<u>seperate</u>';
  const masked=spellingText(text);
  assert.equal(masked.length,text.length);
  for(const word of ['recieve','mesage'])assert.equal(masked.indexOf(word),text.indexOf(word));
  assert.equal(masked.indexOf('seperate'),text.lastIndexOf('seperate'));
  assert.ok(!masked.includes('https:'));assert.ok(!masked.includes('mispelled'));assert.ok(!masked.includes('recieve()'));assert.ok(!masked.includes('<u>'));
});

test('macOS dictionaries find typing errors and return corrections at JavaScript offsets', {skip:process.platform!=='darwin'},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'draft-spelling-')),binary=join(folder,'draft-spelling');
  const build=Bun.spawn(['xcrun','swiftc',join(import.meta.dir,'../native/Spelling.swift'),'-o',binary],{stdout:'ignore',stderr:'pipe'});
  assert.equal(await build.exited,0,await new Response(build.stderr).text());
  const service=new NativeSpelling(binary);
  try{
    const text='😀 I can recieve a seperate mesage.';
    const [checked,guesses]=await Promise.all([service.request({text}),service.request({word:'recieve'})]);
    for(const word of ['recieve','seperate','mesage']){
      const mark=checked.words.find((mark:{word:string})=>mark.word===word);assert.ok(mark,word);assert.equal(text.slice(mark.from,mark.to),word);
    }
    assert.ok(guesses.suggestions.includes('receive'));
    assert.deepEqual((await service.request({text:'I can receive a separate message.'})).words,[]);
    await assert.rejects(service.request({text:'a'.repeat(200001)}));
  }finally{service.close();await rm(folder,{recursive:true,force:true});}
});
