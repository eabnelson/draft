import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';

type Coverage={schemaVersion:1;sourceHash:string;features:Record<string,{scenes:string[];review:string}>};
export async function demoSourceHash(root:string){
 const catalog=JSON.parse(await readFile(join(root,'features.json'),'utf8'));delete catalog.appVersion;
 const hash=createHash('sha256').update(JSON.stringify(catalog));
 async function visit(folder:string){
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   if(['node_modules','dist','.DS_Store'].includes(entry.name))continue;
   const path=join(folder,entry.name);
   if(entry.isDirectory())await visit(path);
   else if(entry.isFile()){
    let bytes=await readFile(path);
    // A release stamp changes only this literal, never the demonstrated behavior.
    if(relative(root,path)==='desktop/updates.ts')bytes=Buffer.from(bytes.toString().replace(/const nativeHostVersion='[^']+';/,"const nativeHostVersion='RELEASE';"));
    hash.update(relative(root,path));hash.update(bytes);
   }
  }
 }
 for(const folder of ['src','desktop','native','host-ui'])await visit(join(root,folder));
 return hash.digest('hex');
}
export async function checkDemoParity(root:string,review=false){
 const path=join(root,'website/demo/coverage.json'),coverage=JSON.parse(await readFile(path,'utf8')) as Coverage;
 const catalog=JSON.parse(await readFile(join(root,'features.json'),'utf8'));
 const ids=catalog.features.filter((feature:any)=>feature.origin==='official').map((feature:any)=>feature.id).sort();
 if(coverage.schemaVersion!==1||JSON.stringify(Object.keys(coverage.features).sort())!==JSON.stringify(ids))throw Error('Update website/demo/coverage.json for every current official feature before reviewing the demo.');
 for(const id of ids){const entry=coverage.features[id];if(!entry.review?.trim()||!Array.isArray(entry.scenes)||!entry.scenes.length)throw Error(`Record the demo scene or review decision for ${id}.`);}
 const sourceHash=await demoSourceHash(root);
 if(review){coverage.sourceHash=sourceHash;await writeFile(path,JSON.stringify(coverage,null,2)+'\n');}
 else if(sourceHash!==coverage.sourceHash)throw Error('App features or UI changed since the demo was reviewed. Update the shared walkthrough and coverage notes, run bun run demo:review, build and test the demo, then commit coverage.json.');
 return sourceHash;
}
if(import.meta.main){await checkDemoParity(resolve(import.meta.dir,'..'),process.argv.includes('--review'));console.log('Website demo matches the reviewed app source.');}
