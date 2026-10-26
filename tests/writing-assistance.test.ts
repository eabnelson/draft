import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writingSchema} from '../desktop/writing';
import {parseWritingResult} from '../src/writing-assistance';
test('writing assistance handles JSON and a single fenced JSON answer',()=>{
  const answer={cuts:[{text:'a little',reason:'Tighter.'}]};
  for(const raw of [JSON.stringify(answer),'```json\n'+JSON.stringify(answer)+'\n```'])assert.deepEqual(parseWritingResult(raw),answer);
  for(const raw of ['Before {"cuts":[]} after','[]','null','```json\ninvalid\n```'])assert.throws(()=>parseWritingResult(raw),/unreadable/);
});
test('each writing request constrains the provider to its actual response shape',()=>{
  for(const [kind,key] of [['alternatives','alternatives'],['trim','cuts'],['review','flags']]){
    const schema=writingSchema(kind)!;assert.deepEqual(schema.required,[key]);assert.equal(schema.additionalProperties,false);assert.ok((schema.properties as Record<string,unknown>)[key]);
  }
  assert.equal(writingSchema(undefined),undefined);assert.throws(()=>writingSchema('execute'),/writing request/);
});
