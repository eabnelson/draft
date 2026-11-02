import {expect,test} from 'bun:test';
import {DemoStore,TOUR} from '../website/demo/store';
import {walkthroughLayout,fitWalkthrough} from '../website/layout';
import {inboxOrder,openVersions,proseWords,IDEA_WORDS,SUMMARY_WORDS,needsSummary,stage} from '../src/model';
import type {Library} from '../src/client';

test('the walkthrough starts from a believable library with one draft open in two versions',async()=>{
  const store=new DemoStore();store.reset();
  const library=await store.api('/api/library') as Library;
  expect(library.drafts).toHaveLength(4);
  const open=library.drafts.find(d=>d.id===library.active)!;
  expect(inboxOrder(library.drafts)[0].id).toBe(open.id);
  expect(openVersions(open)).toHaveLength(2);
  expect(library.drafts.map(stage).sort()).toEqual(['drafting','idea','live','ready']);
  // The seeded drafts already have their summaries, so the stand-in AI only writes one for the tour's draft.
  expect(library.drafts.filter(needsSummary)).toHaveLength(0);
});

test('what the tour types is long enough for the AI title and summary it shows',()=>{
  expect(proseWords(TOUR.dump)).toBeGreaterThanOrEqual(IDEA_WORDS);
  expect(proseWords(TOUR.dump)).toBeGreaterThanOrEqual(SUMMARY_WORDS);
});

test('the stand-in server saves drafts in memory and answers the AI with canned JSON',async()=>{
  const store=new DemoStore();store.reset();
  const library=await store.api('/api/library') as Library,draft={...library.drafts[0],title:'Changed'};
  await store.api('/api/drafts/save',{draft});
  expect((await store.api('/api/library') as Library).drafts[0].title).toBe('Changed');
  // Edits to the returned library never leak back into the store.
  (await store.api('/api/library') as Library).drafts[0].title='Mutated';
  expect((await store.api('/api/library') as Library).drafts[0].title).toBe('Changed');
  expect(JSON.parse((await store.api('/api/assist',{kind:'title'}) as {response:string}).response)).toEqual({title:TOUR.title});
  expect(JSON.parse((await store.api('/api/assist',{kind:'summary'}) as {response:string}).response)).toEqual({summary:TOUR.summary});
  await expect(store.api('/api/drafts/delete',{id:draft.id})).rejects.toThrow('Mac app');
});

test('the walkthrough window keeps the desktop size and scales to fit',()=>{
  const layout=walkthroughLayout(390,844,true);
  expect(layout).toEqual({id:'desktop',width:1152,height:720});
  expect(fitWalkthrough(576,720,layout)).toEqual({scale:.5,width:576,height:360});
});
