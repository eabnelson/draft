import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,addVariant,addCandidate,choose,ghost,parseDraft,cleanText,editCandidate,validateQuotes,makeCuts,variantScope} from '../src/model';
import {formatMarkdown,plainText,scopeRange,inferWordingScope} from '../src/markdown';
import {comparisonFrequency} from '../src/comparison-sound';

test('the paperclip example adjusts articles and returns to the exact original',()=>{
  let d={...fresh(),text:'Use a paperclip. Another sentence.'};const result=addVariant(d,{from:6,to:15});d=result.draft;
  for(const word of ['thumbtack','eraser','hourglass','unicorn'])d=addCandidate(d,result.variantId,word);
  for(const [index,expected] of [[0,'a thumbtack'],[1,'an eraser'],[2,'an hourglass'],[3,'a unicorn']] as const){d=choose(d,result.variantId,d.variants[0].candidates[index].id);assert.equal(d.text,`Use ${expected}. Another sentence.`);parseDraft(JSON.stringify(d));}
  d=choose(d,result.variantId,null);assert.equal(d.text,'Use a paperclip. Another sentence.');
  const hidden=ghost(d,{from:0,to:d.text.length});const alternate=choose(hidden,result.variantId,hidden.variants[0].candidates[1].id);assert.equal(cleanText(alternate),'');parseDraft(JSON.stringify(alternate));
});
test('article changes preserve capital letters, later annotations, and ambiguous acronyms',()=>{
  let d={...fresh(),text:'A tool. A note.'};const result=addVariant(d,{from:2,to:6});d=addCandidate(result.draft,result.variantId,'eraser');
  const other=addVariant(d,{from:10,to:14});d=other.draft;d=choose(d,result.variantId,d.variants[0].candidates[0].id);
  assert.equal(d.text,'An eraser. A note.');assert.equal(d.text.slice(d.variants[1].from,d.variants[1].to),'note');parseDraft(JSON.stringify(d));
  d=addCandidate(d,result.variantId,'SQL database');d=choose(d,result.variantId,d.variants[0].candidates[1].id);assert.match(d.text,/^An SQL database/);
});
test('formatting writes portable Markdown and toggles without losing the selection',()=>{
  for(const [format,expected] of [['bold','**word**'],['italic','*word*'],['strike','~~word~~'],['underline','<u>word</u>']] as const){
    const edit=formatMarkdown('word',{from:0,to:4},format);assert.equal(edit.insert,expected);
    assert.equal(formatMarkdown(edit.insert,edit.selection,format).insert,'word');
    assert.equal(plainText(edit.insert),'word');
  }
  assert.equal(formatMarkdown('one\ntwo',{from:0,to:7},'number').insert,'1. one\n2. two');
  assert.equal(formatMarkdown('# Hello',{from:2,to:7},'h2').insert,'## Hello');
  assert.equal(formatMarkdown('one',{from:0,to:3},'link','https://example.com/a(b)').insert,'[one](https://example.com/a%28b%29)');
  assert.throws(()=>formatMarkdown('one',{from:0,to:3},'link','javascript:alert(1)'),/web address/);
  assert.equal(formatMarkdown('**word**',{from:2,to:6},'italic').insert,'*word*');
  const italic=formatMarkdown('**word**',{from:2,to:6},'italic');const combined='**word**'.slice(0,italic.from)+italic.insert+'**word**'.slice(italic.to);assert.equal(combined,'***word***');
  assert.equal(formatMarkdown('[word](https://old.example)',{from:1,to:5},'link','https://new.example').insert,'[word](https://new.example)');
});
test('Markdown alternatives, overflow, and manual ghosting round trip together',()=>{
  let d={...fresh(),text:'# Heading\n\nA **first draft**.\n\nKeep this.'};const range={from:d.text.indexOf('**'),to:d.text.indexOf('.\n')};
  const result=addVariant(d,range);d=addCandidate(result.draft,result.variantId,'*second draft*');d=choose(d,result.variantId,d.variants[0].candidates[0].id);
  d=editCandidate(d,result.variantId,d.variants[0].active!,'<u>third draft</u>');assert.match(d.text,/<u>third draft<\/u>/);
  d={...d,overflow:'## Notes\n\n- **Spare idea**'};d=ghost(d,{from:d.text.indexOf('Keep'),to:d.text.length});
  const reopened=parseDraft(JSON.stringify(d));assert.equal(reopened.overflow,d.overflow);assert.equal(plainText(cleanText(reopened)),'Heading\n\nA third draft.');
});
test('word, sentence, and paragraph scopes follow the selected prose',()=>{
  const text='A first thought. Another thought here.\n\nThe next paragraph.';const from=text.indexOf('Another');
  const word=scopeRange(text,{from,to:from},'word');assert.equal(text.slice(word.from,word.to),'Another');
  const sentence=scopeRange(text,{from,to:from},'sentence');assert.equal(text.slice(sentence.from,sentence.to),'Another thought here.');
  const paragraph=scopeRange(text,{from,to:from},'paragraph');assert.equal(text.slice(paragraph.from,paragraph.to),'A first thought. Another thought here.');
});
test('returning to the original has a lower comparison tone',()=>{assert.ok(comparisonFrequency(true)<comparisonFrequency(false));});
test('wording size distinguishes multiple sentences from a long single sentence',()=>{
  assert.equal(inferWordingScope('paperclip'),'word');
  assert.equal(inferWordingScope('A clear sentence.'),'sentence');
  assert.equal(inferWordingScope(Array(45).fill('word').join(' ')+'.'),'sentence');
  assert.equal(inferWordingScope('A first thought. Another thought.'),'paragraph');
  assert.equal(inferWordingScope('One line\nAnother line'),'paragraph');
});
test('a paragraph keeps its size through shorter alternatives, edits, and reopening',()=>{
  const original='A short paragraph.',result=addVariant({...fresh(),text:original},{from:0,to:original.length},'paragraph');
  let draft=addCandidate(result.draft,result.variantId,'Brief.');draft=choose(draft,result.variantId,draft.variants[0].candidates[0].id);
  draft=editCandidate(draft,result.variantId,draft.variants[0].active!,'Smaller.');draft=parseDraft(JSON.stringify(draft));
  assert.equal(variantScope(draft.variants[0]),'paragraph');assert.equal(draft.text,'Smaller.');
  assert.equal(variantScope(choose(draft,result.variantId,null).variants[0]),'paragraph');
});
test('switching the size of the same passage retains its original and alternatives',()=>{
  const original='One complete sentence.',result=addVariant({...fresh(),text:original},{from:0,to:original.length},'sentence');
  const before=addCandidate(result.draft,result.variantId,'Another sentence.'),updated=addVariant(before,{from:0,to:original.length},'paragraph');
  assert.equal(updated.variantId,result.variantId);assert.equal(updated.draft.variants.length,1);assert.equal(variantScope(updated.draft.variants[0]),'paragraph');
  assert.deepEqual(updated.draft.variants[0].candidates,before.variants[0].candidates);assert.equal(updated.draft.variants[0].original,original);
});
test('legacy wording sizes use the original while invalid stored sizes are rejected',()=>{
  const original='First sentence. Second sentence.',result=addVariant({...fresh(),text:original},{from:0,to:original.length});
  let draft=addCandidate(result.draft,result.variantId,'Short.');draft=choose(draft,result.variantId,draft.variants[0].candidates[0].id);
  delete draft.variants[0].scope;const reopened=parseDraft(JSON.stringify(draft));assert.equal(variantScope(reopened.variants[0]),'paragraph');
  const invalid=JSON.parse(JSON.stringify(draft));invalid.variants[0].scope='line';assert.throws(()=>parseDraft(JSON.stringify(invalid)),/invalid editing data/);
});
test('ghosting and accepting cuts retain valid Markdown and preserve earlier ghosts',()=>{
  let d={...fresh(),text:'Keep **this idea**. Maybe trim [spare words](https://example.com).\n\nA final thought.'};
  const from=d.text.indexOf('this idea');d=ghost(d,{from,to:from+9});assert.ok(!cleanText(d).includes('**'));
  const cuts=validateQuotes(d,[{text:'spare words'}]);assert.equal(cuts[0].text,'[spare words](https://example.com)');
  const next=makeCuts(d,cuts);assert.equal(next.ghosts.length,1);assert.ok(next.text.includes('**this idea**'));assert.ok(!next.text.includes('https://example.com'));assert.ok(next.text.endsWith('A final thought.'));parseDraft(JSON.stringify(next));
  assert.equal(makeCuts(d,cuts.map(c=>({...c,accepted:false}))),d);
});
