import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,addCandidate,choose,editCandidate,parseDraft} from '../src/model';

test('each alternative retains its own provider through edits, choosing and reopening',()=>{
  let draft=fresh(true);const id=draft.variants[0].id;
  draft=addCandidate(draft,id,'a quieter start','ai','claude');
  draft=addCandidate(draft,id,'a fresh beginning','ai','codex');
  const [claude,codex]=draft.variants[0].candidates.slice(-2);
  draft=choose(draft,id,claude.id);
  draft=editCandidate(draft,id,claude.id,'a calmer start');
  draft=choose(draft,id,codex.id);
  const reopened=parseDraft(JSON.stringify(draft)).variants[0].candidates;
  assert.equal(reopened.find(c=>c.id===claude.id)?.provider,'claude');
  assert.equal(reopened.find(c=>c.id===claude.id)?.humanEdited,true);
  assert.equal(reopened.find(c=>c.id===codex.id)?.provider,'codex');
});
test('older alternatives reopen without an invented provider',()=>{
  let draft=fresh(true);draft=addCandidate(draft,draft.variants[0].id,'older wording','ai');
  assert.equal(parseDraft(JSON.stringify(draft)).variants[0].candidates.at(-1)?.provider,undefined);
});
test('import rejects invalid alternative providers and human wording never gains one',()=>{
  let draft=fresh(true);draft=addCandidate(draft,draft.variants[0].id,'my wording','human','claude');
  assert.equal(draft.variants[0].candidates.at(-1)?.provider,undefined);
  const invalid=structuredClone(draft) as any;invalid.variants[0].candidates[0].provider='other';
  assert.throws(()=>parseDraft(JSON.stringify(invalid)));
});
