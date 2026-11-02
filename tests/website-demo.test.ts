import {expect,test} from 'bun:test';
import {DemoStore,TOUR,GOAL_FEATURE} from '../website/demo/store';
import type {FeaturesState} from '../desktop/types';
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

test('the walkthrough asks for a feature, builds it, and restarts into it',async()=>{
  const store=new DemoStore();store.reset();
  let state=await store.api('/api/features/queue',{action:'add',request:TOUR.request}) as FeaturesState;
  expect(state.featureQueue?.map(q=>q.request)).toEqual([TOUR.request]);
  const update=await store.api('/api/updates/request',{kind:'batch'}) as {id:string;state:string};
  expect(update.state).toBe('building');
  await expect(store.api('/api/updates/apply',{id:update.id})).rejects.toThrow('not ready');
  // The tour decides when the build is done, so pausing it pauses the build.
  store.finishUpdate();
  const applied=await store.api('/api/updates/apply',{id:update.id}) as {version:string;restart:boolean};
  expect(applied.restart).toBe(false);expect(store.hasGoal).toBe(true);
  await store.api('/api/updates/confirm',{version:applied.version});
  state=store.features();
  expect(state.featureQueue).toHaveLength(0);expect(state.updates[0].state).toBe('applied');
  expect(state.current.features.find(f=>f.id===GOAL_FEATURE)?.origin).toBe('personal');
  expect((await store.api('/api/health') as {version:string}).version).toBe(applied.version);
  store.reset();expect(store.hasGoal).toBe(false);
});
