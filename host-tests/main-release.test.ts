import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {nextPreviewVersion,versionContents,versionFiles} from '../scripts/release-version';
import {prepareMainRelease} from '../scripts/main-release';

const root=resolve(import.meta.dir,'..'),source='a'.repeat(40),releaseSHA='b'.repeat(40);
test('main versions advance past reserved and published alpha tags and never cross a stable release',()=>{
 assert.equal(nextPreviewVersion('0.2.0-alpha.20',['v0.2.0-alpha.9','v0.2.0-alpha.21','v0.2.0-alpha.25','irrelevant']),'0.2.0-alpha.26');
 assert.equal(nextPreviewVersion('0.3.0-alpha.1',['v0.2.0','v0.2.0-alpha.99']),'0.3.0-alpha.2');
 assert.throws(()=>nextPreviewVersion('0.2.0-alpha.20',['v0.2.0']),/next alpha series/);
 assert.throws(()=>nextPreviewVersion('0.2.0',[]),/tagged explicitly/);
});
test('a release stamps all six version locations without changing feature dates or other app code',async()=>{
 const files=await versionContents(root,'0.2.0-alpha.87');
 assert.equal(JSON.parse(files['package.json']).version,'0.2.0-alpha.87');assert.equal(JSON.parse(files['features.json']).appVersion,'0.2.0-alpha.87');
 assert.deepEqual(JSON.parse(files['features.json']).features,JSON.parse(await readFile(join(root,'features.json'),'utf8')).features);
 assert.equal(JSON.parse(files['src-tauri/tauri.conf.json']).version,'0.2.0-alpha.87');
 assert.match(files['src-tauri/Cargo.lock'],/name = "draft-desktop"\nversion = "0.2.0-alpha.87"/);
 assert.match(files['src-tauri/Cargo.toml'],/version = "0.2.0-alpha.87"/);
 assert.equal(files['desktop/updates.ts'].replace("const nativeHostVersion='0.2.0-alpha.87';",''),(await readFile(join(root,'desktop/updates.ts'),'utf8')).replace(/const nativeHostVersion='[^']+';/,''));
 assert.deepEqual(Object.keys(files),[...versionFiles]);
});
test('checked main creates one immutable release commit; retry reuses it and public releases are not rebuilt',async()=>{
 const calls:string[]=[],tags:any[]=[],commits:Record<string,any>={[source]:{tree:{sha:'original-tree'},parents:[],message:'App changes'}};let published=false,createdFiles:any[]=[];
 const api=async(path:string,body?:any):Promise<any>=>{
  calls.push(path);
  if(path==='/git/ref/heads/main')return {object:{sha:source}};
  if(path.startsWith('/tags?'))return tags;
  if(path.startsWith('/git/commits/'))return commits[path.split('/').at(-1)!];
  if(path==='/git/trees'){assert.equal(body.base_tree,'original-tree');createdFiles=body.tree;return {sha:'release-tree'};}
  if(path==='/git/commits'){assert.deepEqual(body.parents,[source]);commits[releaseSHA]={...body,parents:body.parents.map((sha:string)=>({sha}))};return {sha:releaseSHA};}
  if(path==='/git/refs'){tags.push({name:body.ref.replace('refs/tags/',''),commit:{sha:body.sha}});return {};}
  if(path.startsWith('/releases/tags/'))return published?{draft:false}:null;
  throw Error(path);
 };
 const first=await prepareMainRelease(root,source,api);assert.equal(first.skipped,false);assert.equal(first.sha,releaseSHA);assert.ok(first.tag);
 const stamped=Object.fromEntries(createdFiles.map(file=>[file.path,file.content]));assert.equal(JSON.parse(stamped['package.json']).version,first.tag!.slice(1));
 assert.deepEqual(await prepareMainRelease(root,source,api),first);assert.equal(calls.filter(path=>path==='/git/refs').length,1);
 published=true;assert.deepEqual(await prepareMainRelease(root,source,api),{skipped:true});
 // Stamping is performed in the release tree, never in the source checkout.
 assert.notEqual(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,first.tag!.slice(1));
});
test('superseded main and invalid source identities cannot create a release',async()=>{
 const calls:string[]=[];const api=async(path:string)=>{calls.push(path);return {object:{sha:'c'.repeat(40)}};};
 assert.deepEqual(await prepareMainRelease(root,source,api),{skipped:true});assert.deepEqual(calls,['/git/ref/heads/main']);
 await assert.rejects(prepareMainRelease(root,'main',api),/checked main/);
});
