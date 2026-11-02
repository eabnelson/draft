import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writingSchema} from '../desktop/writing';
import {parseWritingResult} from '../src/writing-assistance';
test('writing assistance handles JSON and a single fenced JSON answer',()=>{
  const answer={title:'A better title'};
  for(const raw of [JSON.stringify(answer),'```json\n'+JSON.stringify(answer)+'\n```'])assert.deepEqual(parseWritingResult(raw),answer);
  for(const raw of ['Before {"title":"x"} after','[]','null','```json\ninvalid\n```'])assert.throws(()=>parseWritingResult(raw),/unreadable/);
});
test('a title request constrains the provider to a single short title',()=>{
  const schema=writingSchema('title')!;assert.deepEqual(schema.required,['title']);assert.equal(schema.additionalProperties,false);
  assert.deepEqual(writingSchema('summary')!.required,['summary']);
  assert.equal(writingSchema(undefined),undefined);for(const kind of ['execute','alternatives','trim'])assert.throws(()=>writingSchema(kind),/writing request/);
});
