import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateLegacyLibrary} from '../desktop/native-migration';
import {exists,sourceHash} from '../desktop/files';

test('first native launch atomically copies writing and recovery, leaving source and existing native writing untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-library-import-')),legacy=join(root,'Draft'),native=join(root,'Draft Native');
 try{
  for(const name of ['Drafts','Documents','Exports','Recovery']){await mkdir(join(legacy,name),{recursive:true});await writeFile(join(legacy,name,'saved.txt'),'café 日本語 👩🏽‍💻');}
  await writeFile(join(legacy,'Drafts/library.json'),JSON.stringify({schemaVersion:1}));
  await writeFile(join(legacy,'state.json'),'old application versions');await writeFile(join(legacy,'zo-sync.json'),'old sync identity');
  const before=await sourceHash(legacy);assert.equal(await migrateLegacyLibrary(legacy,native),true);
  for(const name of ['Drafts','Documents','Exports','Recovery'])assert.equal(await readFile(join(native,name,'saved.txt'),'utf8'),'café 日本語 👩🏽‍💻');
  assert.equal(await sourceHash(legacy),before);assert.equal(await exists(join(native,'state.json')),false);assert.equal(await exists(join(native,'zo-sync.json')),false);
  await writeFile(join(native,'Drafts/saved.txt'),'New native writing');
  assert.equal(await migrateLegacyLibrary(legacy,native),false);assert.equal(await readFile(join(native,'Drafts/saved.txt'),'utf8'),'New native writing');
  assert.deepEqual((await readdir(root)).sort(),['Draft','Draft Native']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('import waits for the legacy app to close and does not create an empty destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-library-import-')),legacy=join(root,'Draft'),native=join(root,'Draft Native');
 try{
  assert.equal(await migrateLegacyLibrary(legacy,native),false);assert.equal(await exists(native),false);
  await mkdir(join(legacy,'Drafts'),{recursive:true});await writeFile(join(legacy,'Drafts/library.json'),'{}');
  await writeFile(join(legacy,'runtime-info.json'),JSON.stringify({hostPid:process.pid}));
  await assert.rejects(migrateLegacyLibrary(legacy,native),/Quit the previous Draft/);assert.equal(await exists(native),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
