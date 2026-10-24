import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { fresh, parseDraft, addVariant, addCandidate, choose, removeCandidate, replace, applyChanges, ghost, stash, cleanText, validateQuotes, words, variantContext } from '../src/model';

test('sample and empty documents round trip with every annotation intact',()=>{
  for(const d of [fresh(),fresh(true)])assert.equal(parseDraft(JSON.stringify(d)).text,d.text);
});
test('different-length wording preserves surrounding text and the original',()=>{
  const d=fresh(true),v=d.variants[0],c=v.candidates[1];const n=choose(d,v.id,c.id);
  assert.equal(n.text,d.text.slice(0,v.from)+c.text+d.text.slice(v.to));
  assert.equal(n.variants[0].original,v.original);
  assert.equal(choose(n,v.id,null).text,d.text);
  parseDraft(JSON.stringify(n));
});
test('annotations follow edits before and inside a passage',()=>{
  let d=fresh(true),v=d.variants[0];d=replace(d,0,0,'Hello.\n\n');v=d.variants[0];
  assert.equal(d.text.slice(v.from,v.to),v.original);
  d=replace(d,v.from+2,v.from+8,'bit of');v=d.variants[0];
  assert.equal(v.original,'a little room to breathe');assert.equal(v.candidates.length,3);assert.ok(v.active);
  parseDraft(JSON.stringify(d));
});
test('replacing the first or last word within a variant keeps inserted text inside it',()=>{
  let d=fresh(true),v=d.variants[0];d=replace(d,v.from,v.from+1,'some');v=d.variants[0];
  assert.equal(d.text.slice(v.from,v.to),'some little room to breathe');parseDraft(JSON.stringify(d));
  d=replace(d,v.to-7,v.to,'think');parseDraft(JSON.stringify(d));
});
test('insertion adjacent to an annotation stays outside it',()=>{
  let d=fresh(true),v=d.variants[0];d=replace(d,v.from,v.from,'more ');v=d.variants[0];
  assert.equal(d.text.slice(v.from,v.to),v.original);assert.equal(v.active,null);
  d=replace(d,v.to,v.to,' today');v=d.variants[0];assert.equal(d.text.slice(v.from,v.to),v.original);
});
test('multi-paragraph alternatives keep stable ranges through multiple changes',()=>{
  let d={...fresh(),text:'Intro.\n\nFirst paragraph.\n\nSecond paragraph.\n\nEnd.'};
  const from=d.text.indexOf('First'),to=d.text.indexOf('\n\nEnd');const result=addVariant(d,{from,to});d=addCandidate(result.draft,result.variantId,'One new paragraph.\n\nAnother new one.');
  d=choose(d,result.variantId,d.variants[0].candidates[0].id);parseDraft(JSON.stringify(d));
  d=applyChanges(d,ChangeSet.of([{from:0,insert:'A '},{from:d.text.length,insert:' Bye.'}],d.text.length));
  assert.equal(choose(d,result.variantId,null).text,'A Intro.\n\nFirst paragraph.\n\nSecond paragraph.\n\nEnd. Bye.');
});
test('removing an active alternative restores the original and unwraps the last option',()=>{
  let d={...fresh(),text:'A short note.'};const result=addVariant(d,{from:2,to:7});d=addCandidate(result.draft,result.variantId,'longer');const cid=d.variants[0].candidates[0].id;
  d=choose(d,result.variantId,cid);d=removeCandidate(d,result.variantId,cid);assert.equal(d.text,'A short note.');assert.equal(d.variants.length,0);
});
test('ghosts containing complete variants preserve alternatives when switched',()=>{
  let d=fresh(true),v=d.variants[0];d=ghost(d,{from:v.from-3,to:v.to+1});d=choose(d,v.id,v.candidates[1].id);
  assert.equal(cleanText(d).includes(v.candidates[1].text),false);parseDraft(JSON.stringify(d));
  assert.throws(()=>ghost(fresh(true),{from:v.from+1,to:v.to}),/whole marked passage/);
});
test('overflow moves are atomic and protect annotation metadata',()=>{
  let d={...fresh(),text:'First.\n\nSecond.\n\nLast.'};const before=JSON.stringify(d);d=stash(d,{from:8,to:15});
  assert.equal(d.overflow,'Second.');assert.equal(d.text,'First.\n\n\n\nLast.');assert.equal(words(cleanText(d)),2);
  const annotated=fresh(true);assert.throws(()=>stash(annotated,annotated.variants[0]),/editing history/);assert.ok(before);
});
test('deleting or replacing the entire document removes its annotations',()=>{
  let d=fresh(true);d=ghost(d,{from:0,to:27});d=replace(d,0,d.text.length,'A new draft.');assert.equal(d.variants.length,0);assert.equal(d.ghosts.length,0);parseDraft(JSON.stringify(d));
});
test('imports reject invalid versions, overlaps, provenance, and selected text mismatch',()=>{
  const d=fresh(true);for(const patch of [{version:2},{variants:[{...d.variants[0],to:999999}]},{variants:[{...d.variants[0],active:'missing'}]},{variants:[{...d.variants[0],original:'wrong'}]},{ghosts:[{id:'g',from:d.variants[0].from+1,to:d.variants[0].to}]}])assert.throws(()=>parseDraft(JSON.stringify({...d,...patch})));
  assert.throws(()=>parseDraft('broken'));assert.throws(()=>parseDraft(JSON.stringify({...d,variants:[...d.variants,{...d.variants[0],id:'second'}]})));
});
test('AI quote validation rejects ambiguous, overlapping, ghosted, and partial-variant cuts',()=>{
  const d=fresh(true),v=d.variants[0];assert.equal(validateQuotes(d,[{text:'not in source'},{text:'a'},{text:'little room'}]).length,0);
  assert.equal(validateQuotes(d,[{text:v.original},{text:v.original}]).length,1);
  const hidden=ghost(d,v);assert.equal(validateQuotes(hidden,[{text:v.original}]).length,0);
});
test('10,000 words retain alternatives and ghost state across repeated edits',()=>{
  let d={...fresh(),text:Array.from({length:10000},(_,i)=>`word${i}`).join(' ')};const r=addVariant(d,{from:0,to:11});d=addCandidate(r.draft,r.variantId,'A different start');d=choose(d,r.variantId,d.variants[0].candidates[0].id);
  for(let i=0;i<30;i++)d=replace(d,d.text.length,d.text.length,' end');
  parseDraft(JSON.stringify(d));assert.ok(words(d.text)>=10000);assert.equal(d.variants[0].original,'word0 word1');
});
test('AI context contains only the paragraph, excluding hidden text and overflow',()=>{
  let d=fresh(true);const v=d.variants[0];const from=d.text.indexOf('The first version'),to=d.text.indexOf('Good writing');d=ghost(d,{from,to});d.overflow='PRIVATE NOTES';
  const context=variantContext(d,v);assert.ok(context.includes(v.original));assert.ok(!context.includes('The first version'));assert.ok(!context.includes('PRIVATE NOTES'));assert.ok(!context.includes('Try a different word'));
  assert.ok(!context.includes(v.candidates[0].text));
});
