import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validateQuotes,applyReviewFix,addVariant,addCandidate,parseDraft,cleanText,ghost} from '../src/model';
import {plainText} from '../src/markdown';

test('successive fixes retain and rebase the remaining suggestions in either order',()=>{
  const text='We agree and we keep going. Teh next thought. One last idea.';
  const original={...fresh(),text};
  const flags=[
    {text:'We agree and we keep going.',replacement:'We agree, and we keep going.'},
    {text:'Teh next thought.',replacement:'The next thought.'},
    {text:'One last idea.',replacement:'A final idea.'},
  ];
  for(const order of [[0,1,2],[2,0,1],[1,2,0]]){
    let draft=original,cuts=validateQuotes(draft,flags);const ids=cuts.map(c=>c.id);
    for(const index of order){
      const before=cuts.length,next=applyReviewFix(draft,cuts,ids[index]);draft=next.draft;cuts=next.cuts;
      assert.equal(cuts.length,before-1);
      for(const cut of cuts)assert.equal(draft.text.slice(cut.from,cut.to),cut.text);
    }
    assert.equal(draft.text,'We agree, and we keep going. The next thought. A final idea.');
  }
  assert.equal(original.text,text);
});
test('fixes preserve alternatives, ghosts, and overflow while moving later review ranges',()=>{
  const base={...fresh(),text:'Teh idea. Keep this word. A final thought. An old note.',overflow:'A spare note.'};
  const start=base.text.indexOf('word'),v=addVariant(base,{from:start,to:start+4},'word');
  let draft=addCandidate(v.draft,v.variantId,'phrase');
  draft=ghost(draft,{from:draft.text.indexOf('An old note.'),to:draft.text.length});
  const cuts=validateQuotes(draft,[{text:'Teh idea.',replacement:'The clear idea.'},{text:'A final thought.',replacement:'The final thought.'}]);
  const next=applyReviewFix(draft,cuts,cuts[0].id);draft=next.draft;
  assert.equal(draft.text.slice(draft.variants[0].from,draft.variants[0].to),'word');
  assert.equal(draft.variants[0].original,'word');assert.equal(draft.variants[0].candidates[0].text,'phrase');
  assert.equal(draft.text.slice(draft.ghosts[0].from,draft.ghosts[0].to),'An old note.');
  assert.equal(draft.overflow,'A spare note.');assert.equal(next.cuts.length,1);parseDraft(JSON.stringify(draft));
});
test('an empty replacement removes the passage and keeps adjacent suggestions valid',()=>{
  const draft={...fresh(),text:'Remove.Next.'},cuts=validateQuotes(draft,[{text:'Remove.',replacement:''},{text:'Next.',replacement:'Then.'}]);
  const next=applyReviewFix(draft,cuts,cuts[0].id);assert.equal(next.draft.text,'Next.');assert.equal(next.cuts[0].from,0);
  assert.equal(applyReviewFix(next.draft,next.cuts,next.cuts[0].id).draft.text,'Then.');
});
test('stale or overlapping suggestions cannot partially edit a draft',()=>{
  const draft={...fresh(),text:'A first thought. Another idea.'},cuts=validateQuotes(draft,[{text:'A first thought.',replacement:'The first thought.'}]);
  assert.throws(()=>applyReviewFix({...draft,text:'Changed. Another idea.'},cuts,cuts[0].id),/no longer matches/);
  assert.throws(()=>applyReviewFix(draft,cuts,'missing'),/no longer matches/);
  assert.throws(()=>applyReviewFix(draft,[...cuts,{...cuts[0],id:'overlap'}],cuts[0].id),/no longer matches/);
  assert.equal(draft.text,'A first thought. Another idea.');
});
test('clean exports trim trailing blank space without changing the native document',()=>{
  const draft={...fresh(),text:'# A heading\n\nA final sentence.\n\n \t\n\n',overflow:'Do not include these notes.'};
  assert.equal(cleanText(draft),'# A heading\n\nA final sentence.');
  assert.equal(plainText(cleanText(draft)),'A heading\n\nA final sentence.');
  assert.equal(parseDraft(JSON.stringify(draft)).text,draft.text);
});
