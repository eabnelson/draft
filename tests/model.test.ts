import {test,expect} from 'bun:test';
import {fresh,latest,editVersion,rename,aiTitle,byShortcut,openVersions,setStage,chooseStage,setPinned,needsSummary,setSummary,readingTime,shortReadingTime,characters,versionTitle,renameVersion,inboxOrder,autoStage,addVersion,setVersionHidden,deleteVersion,stage,firstSentence,readingMinutes,proseWords,isEmpty,parseDraft,toRecord,migrateLegacy,type Draft} from '../src/model';

const texts=(d:Draft)=>Object.fromEntries(d.versions.map(v=>[v.id,v.text]));
const roundTrip=(d:Draft)=>parseDraft(JSON.parse(JSON.stringify(toRecord(d))),texts(d));
const long=Array.from({length:60},(_,i)=>`word${i}`).join(' ');

test('a new draft is one empty version titled by its first sentence',()=>{
  let d=fresh();expect(d.versions).toHaveLength(1);expect(isEmpty(d)).toBe(true);expect(stage(d)).toBe('idea');
  d=editVersion(d,d.versions[0].id,'# Launch notes\n\nWe shipped it today. More soon.');
  expect(d.title).toBe('Launch notes');expect(isEmpty(d)).toBe(false);
  d=editVersion(d,d.versions[0].id,'We shipped it today. More soon.');expect(d.title).toBe('We shipped it today.');
});
test('first-sentence titles skip images and shorten long sentences at a word',()=>{
  expect(firstSentence('![](media/0123456789abcdef0123456789abcdef.png)\n\nHello there. Second.')).toBe('Hello there.');
  const title=firstSentence(`${'A very long opening sentence that keeps going '.repeat(4)}end.`);
  expect(title.length).toBeLessThanOrEqual(81);expect(title.endsWith('…')).toBe(true);expect(title).not.toContain('  ');
});
test('renaming makes the title manual, and AI suggestions never replace it',()=>{
  let d=fresh();const v=d.versions[0].id;
  d=editVersion(d,v,'First line.');d=aiTitle(d,'A better title');expect(d.title).toBe('A better title');expect(d.titleSource).toBe('ai');
  d=editVersion(d,v,'Changed first line.');expect(d.title).toBe('A better title');
  d=rename(d,'My name');expect(d.titleSource).toBe('manual');expect(aiTitle(d,'Ignored').title).toBe('My name');
  d=rename(d,'  ');expect(d.titleSource).toBe('sentence');expect(d.title).toBe('Changed first line.');
});
test('stages follow the writing and publishing, and can be set by hand',()=>{
  let d=fresh();expect(stage(d)).toBe('idea');
  d=editVersion(d,d.versions[0].id,long);expect(stage(d)).toBe('drafting');
  // A second version means you are iterating, however short it is.
  expect(stage(addVersion(fresh(),'blank').draft)).toBe('drafting');
  const edited=d.updatedAt;d=setStage(d,'ready');expect(stage(d)).toBe('ready');expect(d.updatedAt).toBe(edited);
  d={...d,publications:[{id:'p',platform:'x',url:'https://x.com/a/status/1',versionId:d.versions[0].id,publishedAt:new Date().toISOString(),text:long}]};
  expect(stage(d)).toBe('ready');expect(autoStage(d)).toBe('live');expect(stage(setStage(d,null))).toBe('live');
  expect(stage(setStage(fresh(),'live'))).toBe('live');
  // Picking the worked-out stage keeps it automatic, so publishing can still make it live.
  const blank=fresh(),drafting=chooseStage(editVersion(blank,blank.versions[0].id,long),'drafting');expect(drafting.manualStage).toBeNull();
  expect(chooseStage(fresh(),'ready').manualStage).toBe('ready');expect(chooseStage(setStage(fresh(),'ready'),'idea').manualStage).toBeNull();
});
test('a summary is written once there is enough, and again after real changes',()=>{
  let d=fresh();const v=d.versions[0].id;expect(needsSummary(d)).toBe(false);
  d=editVersion(d,v,long);expect(needsSummary(d)).toBe(true);
  const edited=d.updatedAt;d=setSummary(d,'  A note about sixty words. ',60);expect(d.summary).toEqual({text:'A note about sixty words.',words:60});expect(d.updatedAt).toBe(edited);
  expect(needsSummary(d)).toBe(false);
  d=editVersion(d,v,long+' and a few more words');expect(needsSummary(d)).toBe(false);
  d=editVersion(d,v,long+' '+long);expect(needsSummary(d)).toBe(true);
});
test('reading time shows seconds under a minute',()=>{
  expect(readingTime(0)).toBe('');expect(readingTime(12)).toBe('3 sec');expect(readingTime(238)).toBe('1 min');expect(readingTime(238*4)).toBe('4 min');
  expect(shortReadingTime(0)).toBe('');expect(shortReadingTime(1)).toBe('1s');expect(shortReadingTime(12)).toBe('3s');expect(shortReadingTime(238)).toBe('1m');expect(shortReadingTime(238*12)).toBe('12m');expect(shortReadingTime(238*70)).toBe('1h');
});
test('only writing moves a draft up; opening, closing, new versions and names do not',()=>{
  const start={...fresh(),updatedAt:'2026-01-01T00:00:00.000Z'},at=start.updatedAt,v1=start.versions[0].id;
  let d=addVersion(start).draft;expect(d.updatedAt).toBe(at);
  d=setVersionHidden(d,v1,true);expect(d.updatedAt).toBe(at);d=setVersionHidden(d,v1,false);expect(d.updatedAt).toBe(at);
  d=rename(d,'Named');expect(d.updatedAt).toBe(at);d=aiTitle(rename(d,''),'From the AI');expect(d.updatedAt).toBe(at);
  d=deleteVersion(d,d.versions[1].id);expect(d.updatedAt).toBe(at);
  d=editVersion(d,v1,'Now it moves.');expect(d.updatedAt>at).toBe(true);
});
test('pinned drafts stay on top without changing when they were edited',()=>{
  const old={...fresh(),updatedAt:'2026-01-01T00:00:00.000Z'},recent={...fresh(),updatedAt:'2026-10-01T00:00:00.000Z'},newest={...fresh(),updatedAt:'2026-10-30T00:00:00.000Z'};
  expect(inboxOrder([old,recent,newest]).map(d=>d.id)).toEqual([newest.id,recent.id,old.id]);
  const pinned=setPinned(old,true);expect(pinned.updatedAt).toBe(old.updatedAt);
  expect(inboxOrder([pinned,recent,newest]).map(d=>d.id)).toEqual([old.id,newest.id,recent.id]);
});
test('new versions start from the latest, a chosen version, or blank, and stay editable',()=>{
  let d=fresh();const v1=d.versions[0].id;d=editVersion(d,v1,'One');
  const two=addVersion(d);d=two.draft;expect(two.version.number).toBe(2);expect(two.version.text).toBe('One');
  d=editVersion(d,two.version.id,'Two');d=editVersion(d,v1,'One, edited');
  expect(d.versions.map(v=>v.text)).toEqual(['One, edited','Two']);
  const three=addVersion(d,'blank');expect(three.version.text).toBe('');expect(three.version.number).toBe(3);
  const four=addVersion(three.draft,v1);expect(four.version.text).toBe('One, edited');expect(latest(four.draft).number).toBe(4);
  expect(()=>addVersion(d,'missing')).toThrow();
});
test('⌘1–⌘8 pick that draft and ⌘9 picks the last',()=>{
  const list=['a','b','c','d','e','f','g','h','i','j'];
  expect(byShortcut(list,1)).toBe('a');expect(byShortcut(list,8)).toBe('h');expect(byShortcut(list,9)).toBe('j');
  expect(byShortcut(['a','b'],3)).toBeUndefined();expect(byShortcut(['a','b'],9)).toBe('b');
});
test('open versions are the columns not closed, oldest first, never none',()=>{
  let d=addVersion(addVersion(fresh()).draft).draft;const [v1,v2,v3]=d.versions;
  d=setVersionHidden(d,v2.id,true);expect(openVersions(d).map(v=>v.id)).toEqual([v1.id,v3.id]);
  d=setVersionHidden(setVersionHidden(d,v1.id,true),v3.id,true);expect(openVersions(d).map(v=>v.id)).toEqual([v3.id]);
});
test('closing a version only hides it; deleting is separate and keeps one version',()=>{
  let d=addVersion(fresh()).draft;const [v1,v2]=d.versions;
  d=setVersionHidden(d,v1.id,true);expect(d.hiddenVersions).toEqual([v1.id]);expect(d.versions).toHaveLength(2);
  d=setVersionHidden(d,v1.id,false);expect(d.hiddenVersions).toEqual([]);
  d=deleteVersion(setVersionHidden(d,v1.id,true),v1.id);expect(d.versions.map(v=>v.id)).toEqual([v2.id]);expect(d.hiddenVersions).toEqual([]);
  expect(()=>deleteVersion(d,v2.id)).toThrow('at least one version');
});
test('word count ignores Markdown and images; reading time rounds with a one-minute minimum',()=>{
  expect(proseWords('**Bold** _words_ here\n\n![](media/0123456789abcdef0123456789abcdef.png)')).toBe(3);
  expect(readingMinutes(0)).toBe(0);expect(readingMinutes(10)).toBe(1);expect(readingMinutes(238*3)).toBe(3);expect(readingMinutes(238*3+150)).toBe(4);
});
test('draft records round trip and reject invalid data',()=>{
  let d=addVersion(fresh()).draft;d=editVersion(d,d.versions[1].id,'Hello.');
  expect(roundTrip(d)).toEqual(d);
  const record=toRecord(d);
  for(const bad of [{...record,format:'other'},{...record,id:'../x'},{...record,versions:[]},{...record,titleSource:'guess'},{...record,versions:[record.versions[0],{...record.versions[1],number:1}]},{...record,publications:[{id:'p',platform:'myspace',url:'https://a.b',versionId:record.versions[0].id,publishedAt:record.createdAt,text:''}]}])expect(()=>parseDraft(bad,texts(d))).toThrow();
  expect(()=>parseDraft({...record,manualStage:'published'},texts(d))).toThrow();
  expect(()=>parseDraft({...record,summary:{text:5,words:1}},texts(d))).toThrow();
  expect(parseDraft({...record,summary:{text:'About this.',words:30}},texts(d)).summary).toEqual({text:'About this.',words:30});
  // Drafts saved with the earlier "ready" flag keep their status.
  const {manualStage:_m,pinned:_p,summary:_s,...older}=record;
  const upgraded=parseDraft({...older,ready:true},texts(d));expect(upgraded.manualStage).toBe('ready');expect(upgraded.pinned).toBe(false);expect(upgraded.summary).toBeNull();expect('ready' in upgraded).toBe(false);
  expect(parseDraft({...older,ready:false},texts(d)).manualStage).toBeNull();
  expect(()=>parseDraft(record,{})).toThrow();expect(()=>parseDraft({...record,schemaVersion:2},texts(d))).toThrow('newer version');
  // Fields from newer or personal features survive.
  expect((parseDraft({...record,custom:{kept:true}},texts(d)) as any).custom).toEqual({kept:true});
});
test('Draft 1 documents migrate to one version that reads exactly as before',()=>{
  const legacy={format:'writing-room',version:1,id:'old-1',title:'My post',text:'Hello world.\n\n![](/api/images/0123456789abcdef0123456789abcdef.png "draft-crop:tiktok 1 2 3 /api/images/fedcba9876543210fedcba9876543210.jpg")',variants:[{id:'v',from:6,to:11,original:'earth',candidates:[{id:'c',text:'world',origin:'human'}],active:'c'}],ghosts:[{id:'g',from:0,to:5}],overflow:'Spare idea',revision:3,revisionMode:true,updatedAt:'2026-10-20T00:00:00Z'};
  const d=migrateLegacy(legacy);
  expect(d.id).toBe('old-1');expect(d.title).toBe('My post');expect(d.titleSource).toBe('manual');expect(d.versions).toHaveLength(1);
  expect(d.versions[0].text).toBe('Hello world.\n\n![](media/0123456789abcdef0123456789abcdef.png "draft-crop:tiktok 1 2 3 media/fedcba9876543210fedcba9876543210.jpg")\n\n## Overflow\n\nSpare idea');
  expect(migrateLegacy({...legacy,title:'Untitled draft',overflow:''}).title).toBe('Hello world.');
  expect(()=>migrateLegacy({format:'draft'})).toThrow();
  expect(roundTrip(d)).toEqual(d);
});

test('each version is named by its own first sentence and counts its characters',()=>{
  const d=rename(fresh(),'An AI title'),v={...latest(d),text:'# Second take. More words here.\n\nAnother line.'};
  expect(versionTitle(v)).toBe('Second take.');
  expect(versionTitle({...v,text:''})).toBe('');
  expect(characters('**Hi** there\n\nyou')).toBe(12);
  expect(characters('')).toBe(0);
});

test('a version can be named, and an empty name goes back to its first sentence',()=>{
  const start=fresh(),v=start.versions[0];
  const written=editVersion(start,v.id,'First line here. Then more.');
  const named=renameVersion(written,v.id,'  My   take ');
  expect(versionTitle(named.versions[0])).toBe('My take');
  expect(named.updatedAt).toBe(written.updatedAt);
  const texts={[v.id]:named.versions[0].text};
  expect(parseDraft(toRecord(named),texts).versions[0].name).toBe('My take');
  const cleared=renameVersion(named,v.id,'');
  expect('name' in cleared.versions[0]).toBe(false);
  expect(versionTitle(cleared.versions[0])).toBe('First line here.');
  expect(()=>parseDraft({...toRecord(named),versions:[{...toRecord(named).versions[0],name:7}]},texts)).toThrow();
});
