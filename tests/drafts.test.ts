import {test,expect} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DraftStore} from '../desktop/documents';
import {copyImageFile} from '../desktop/images';
import {atomicWrite} from '../desktop/files';
import {plainText} from '../src/markdown';
import {fresh,editVersion,addVersion,deleteVersion} from '../src/model';

const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
async function folder(name:string,run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),`draft-${name}-`));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test('each draft is a package of Markdown versions that reopens exactly',()=>folder('packages',async root=>{
  const store=new DraftStore(root);const first=await store.load();expect(first.drafts).toHaveLength(1);
  let d=fresh();const v1=d.versions[0].id;d=editVersion(d,v1,'# One\n\nFirst version.');
  const second=addVersion(d);d=editVersion(second.draft,second.version.id,'Second version.');
  await store.save(d);await store.setActive(d.id);
  const path=join(root,`${d.id}.draft`);
  expect(await readFile(join(path,'versions/v1.md'),'utf8')).toBe('# One\n\nFirst version.');
  expect(await readFile(join(path,'versions/v2.md'),'utf8')).toBe('Second version.');
  expect(JSON.parse(await readFile(join(path,'draft.json'),'utf8')).versions[0].text).toBeUndefined();
  const reopened=await new DraftStore(root).load();expect(reopened.active).toBe(d.id);expect(reopened.drafts.find(x=>x.id===d.id)).toEqual(d);
}));
test('changed and deleted versions keep a recovery copy; invalid drafts are never written',()=>folder('recovery',async root=>{
  const store=new DraftStore(root);let d=addVersion(fresh()).draft;d=editVersion(d,d.versions[0].id,'Before');await store.save(d);
  d=editVersion(d,d.versions[0].id,'After');await store.save(d);
  expect(await readFile(join(root,'Recovery',d.id,'v1.previous.md'),'utf8')).toBe('Before');
  d=deleteVersion(d,d.versions[1].id);await store.save(d);
  expect((await readdir(join(root,'Recovery',d.id))).some(n=>n.endsWith('-v2.md'))).toBe(true);
  expect((await readdir(join(root,`${d.id}.draft`,'versions')))).toEqual(['v1.md']);
  await expect(store.save({...d,id:'../escape'})).rejects.toThrow();
  await expect(store.save({...d,versions:[]})).rejects.toThrow();
  expect((await store.load()).drafts.find(x=>x.id===d.id)?.versions[0].text).toBe('After');
}));
test('Draft 1 libraries migrate once, with images moved into each draft and originals left in place',()=>folder('migrate',async root=>{
  const legacy=join(root,'Documents'),name='0123456789abcdef0123456789abcdef.png';
  await atomicWrite(join(legacy,'images',name),png);
  await atomicWrite(join(legacy,'a.draft.json'),JSON.stringify({format:'writing-room',version:1,id:'a',title:'Kept title',text:`Hi.\n\n![](/api/images/${name})`,variants:[],ghosts:[],overflow:'',revision:1,revisionMode:false,updatedAt:'2026-10-20T00:00:00Z'}));
  await atomicWrite(join(legacy,'b.draft.json'),JSON.stringify({format:'writing-room',version:1,id:'b',title:'Untitled draft',text:'Archived words.',variants:[],ghosts:[],overflow:'',revision:1,revisionMode:false,updatedAt:'2026-10-21T00:00:00Z'}));
  await atomicWrite(join(legacy,'library.json'),JSON.stringify({version:1,active:'a',drafts:['a'],archived:['b']}));
  const store=new DraftStore(join(root,'Drafts'),legacy),library=await store.load();
  expect(library.active).toBe('a');expect(library.archived).toBe(1);
  const a=library.drafts.find(d=>d.id==='a')!;expect(a.title).toBe('Kept title');expect(a.versions[0].text).toBe(`Hi.\n\n![](media/${name})`);
  expect(await readFile(join(root,'Drafts','a.draft','media',name))).toEqual(Buffer.from(png));
  expect(await stat(join(legacy,'a.draft.json'))).toBeTruthy();
  // Migration only happens once.
  await rm(join(root,'Drafts','a.draft'),{recursive:true});expect((await new DraftStore(join(root,'Drafts'),legacy).load()).drafts.some(d=>d.id==='a')).toBe(false);
  const restored=await store.restoreLast();expect(restored?.id).toBe('b');expect(restored?.title).toBe('Archived words.');
}));
test('media is checked by its bytes, shared within a draft, and served only from that draft',()=>folder('media',async root=>{
  const store=new DraftStore(root),d=fresh();
  const first=await store.saveMedia(d.id,png,'image/png'),again=await store.saveMedia(d.id,png,'image/png');
  expect(first.src).toMatch(/^media\/[a-f0-9]{32}\.png$/);expect(again.src).toBe(first.src);
  await expect(store.saveMedia(d.id,png,'image/jpeg')).rejects.toThrow('not a valid image');
  await expect(store.saveMedia(d.id,png,'image/svg+xml')).rejects.toThrow();
  const name=first.src.slice('media/'.length);
  expect((await store.mediaResponse(d.id,name)).status).toBe(200);
  for(const bad of ['../draft.json','x.png',name.replace('.png','.svg')])expect((await store.mediaResponse(d.id,bad)).status).toBe(404);
  expect((await store.mediaResponse(fresh().id,name)).status).toBe(404);
  // Media pasted before the first save does not create a broken draft.
  expect((await store.load()).drafts.some(x=>x.id===d.id)).toBe(false);
  const runs:string[][]=[];await copyImageFile(store.mediaPath(d.id,name),async args=>{runs.push(args);});
  expect(runs[0].at(-1)).toBe(join(root,`${d.id}.draft`,'media',name));expect(runs[0].join(' ')).toContain('«class PNGf»');
  await expect(copyImageFile(store.mediaPath(d.id,'ffffffffffffffffffffffffffffffff.png'),async()=>{})).rejects.toThrow('no longer available');
}));
test('undo history is kept per version inside the draft',()=>folder('history',async root=>{
  const store=new DraftStore(root),d=addVersion(fresh()).draft;await store.save(d);
  await store.saveHistory(d.id,d.versions[0].id,{doc:'one',history:[1]});await store.saveHistory(d.id,d.versions[1].id,{doc:'two',history:[2]});
  expect(await store.history(d.id,d.versions[0].id)).toEqual({doc:'one',history:[1]});
  expect(await store.history(d.id,d.versions[1].id)).toEqual({doc:'two',history:[2]});
  expect(await store.history(d.id,'missing')).toBeNull();
  await expect(store.history(d.id,'../draft')).rejects.toThrow();
}));
test('archiving moves a draft out of the inbox until it is restored',()=>folder('archive',async root=>{
  const store=new DraftStore(root),a=fresh(),b=fresh();
  await store.save(editVersion(a,a.versions[0].id,'Keep me'));await store.save(editVersion(b,b.versions[0].id,'Archive me'));
  await store.archive(b.id);let library=await store.load();expect(library.drafts.map(d=>d.id)).not.toContain(b.id);expect(library.archived).toBe(1);
  await expect(store.save(b)).rejects.toThrow('archived');
  expect((await store.restoreLast())?.id).toBe(b.id);library=await store.load();expect(library.drafts.map(d=>d.id)).toContain(b.id);
}));
test('deleting a draft moves it to Recovery and it cannot be saved again',()=>folder('delete',async root=>{
  const store=new DraftStore(root),a=fresh(),b=fresh();
  const d=editVersion(a,a.versions[0].id,'Delete me');await store.save(d);await store.save(b);
  await store.delete(d.id);
  expect((await store.load()).drafts.map(x=>x.id)).not.toContain(d.id);
  const kept=await readdir(join(root,'Recovery','Deleted'));expect(kept).toHaveLength(1);
  expect(await readFile(join(root,'Recovery','Deleted',kept[0],'versions','v1.md'),'utf8')).toBe('Delete me');
  await expect(store.save(d)).rejects.toThrow('deleted');
  await expect(store.delete(d.id)).rejects.toThrow();
}));
test('export writes every version as Markdown and text beside the media',()=>folder('export',async root=>{
  const store=new DraftStore(join(root,'Drafts'));let d=fresh();
  const {src}=await store.saveMedia(d.id,png,'image/png');
  d=editVersion(d,d.versions[0].id,`**Hello** world.\n\n![](${src})`);const two=addVersion(d);d=editVersion(two.draft,two.version.id,'Second _take_.');await store.save(d);
  const out=await store.export(d.id,join(root,'Exports'),plainText);
  expect((await readdir(out)).sort()).toEqual(['draft.json','media','v1.md','v1.txt','v2.md','v2.txt']);
  expect(await readFile(join(out,'v1.txt'),'utf8')).toBe('Hello world.');expect(await readFile(join(out,'v2.md'),'utf8')).toBe('Second _take_.');
  expect(await readdir(join(out,'media'))).toEqual([src.slice('media/'.length)]);
}));
