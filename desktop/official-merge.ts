import {readFile,readdir,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {mergeDiff3} from 'node-diff3';
import {atomicWrite,readJSON} from './files';
import {validateCatalog,differences} from './catalog';
import type {Catalog,Feature} from './types';

export type ConflictChoice='keep-mine'|'use-official'|'combine';
export type UpdateConflict={id:string;title:string;description:string;mine:string;official:string;featureIds:string[];paths:string[]};
export type MergeResult={catalog:Catalog;conflicts:UpdateConflict[];needsAgent:boolean;preserved:string[];removed:string[]};
export type MergeInput={base:string;mine:string;official:string;destination:string;choices?:Record<string,ConflictChoice>};
const ignored=(name:string)=>['.git','node_modules','dist','resources','target','release','gen','.draft-upstream','.draft-update.json','.DS_Store','.build-cache'].includes(name)||name.startsWith('.env')||name.endsWith('.tsbuildinfo');
export async function sourceFiles(root:string,prefix=''):Promise<Map<string,Buffer>>{
 const files=new Map<string,Buffer>();for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){if(ignored(entry.name))continue;const path=join(prefix,entry.name);if(entry.isSymbolicLink())throw Error('The update contains an unexpected shortcut.');if(entry.isDirectory())for(const [name,value] of await sourceFiles(root,path))files.set(name,value);else if(entry.isFile())files.set(path,await readFile(join(root,path)));}return files;
}
const same=(a:Buffer|undefined,b:Buffer|undefined)=>a===undefined?b===undefined:b!==undefined&&a.equals(b);
const owns=(feature:Feature,path:string)=>feature.code?.some(name=>path===name||path.startsWith(name+'/'))??false;
const controller=(path:string)=>/^(desktop|scripts|src-tauri|native|host-ui|host-tests)\//.test(path)||path==='update-public-key.pem';

export async function prepareOfficialMerge(input:MergeInput):Promise<MergeResult>{
 const [base,mine,official]=await Promise.all([readJSON<Catalog>(join(input.base,'features.json')),readJSON<Catalog>(join(input.mine,'features.json')),readJSON<Catalog>(join(input.official,'features.json'))]);
 [base,mine,official].forEach(validateCatalog);
 const personal=differences(base,mine),catalog=structuredClone(official),choices=new Map(Object.entries(input.choices??{}));
 const conflicts=new Map<string,UpdateConflict>();let needsAgent=false;
 const conflict=(feature:Feature|undefined,path:string,description='The new Draft changes the same part of your app.')=>{
  const id=feature?.id??'local-changes',entry=conflicts.get(id)??{id,title:feature?.title??'Other app changes',description,mine:feature?.description??'Keep the changes in your app.',official:'Use the new official behavior.',featureIds:feature?[feature.id]:[],paths:[]};if(path&&!entry.paths.includes(path))entry.paths.push(path);conflicts.set(id,entry);
 };
 for(const feature of personal){const b=base.features.find(f=>f.id===feature.id),n=official.features.find(f=>f.id===feature.id);if(n&&!isDeepStrictEqual(n,b)&&!isDeepStrictEqual(n,feature))conflict(feature,'',n.description);}
 for(const feature of personal){
  if(feature.state==='removed'&&official.features.some(next=>next.state==='active'&&next.dependsOn?.includes(feature.id)))conflict(feature,'','A new Draft feature uses something you turned off. Keep it off, or bring it back with the update.');
  if(feature.state==='active')for(const dependency of feature.dependsOn??[]){if(!official.features.some(next=>next.id===dependency&&next.state==='active'))conflict(feature,'','This change uses a feature that the new Draft no longer includes. Keep it with your change, or use Draft’s new version.');}
 }
 for(const feature of personal){if(choices.get(feature.id)==='use-official')continue;catalog.features=catalog.features.filter(next=>next.id!==feature.id);catalog.features.push(structuredClone(feature));}
 // Keep dependencies available for the model to integrate instead of silently
 // leaving a retained personal feature without its supporting capability.
 for(const feature of personal.filter(feature=>feature.state==='active'&&choices.get(feature.id)!=='use-official'))for(const id of feature.dependsOn??[]){if(!catalog.features.some(next=>next.id===id)){const dependency=mine.features.find(next=>next.id===id);if(dependency)catalog.features.push(structuredClone(dependency));}}
 const [before,current,incoming]=await Promise.all([sourceFiles(input.base),sourceFiles(input.mine),sourceFiles(input.official)]);
 const output=new Map<string,Buffer>();
 for(const name of new Set([...before.keys(),...current.keys(),...incoming.keys()])){
  if(name==='features.json')continue;
  const b=before.get(name),m=current.get(name),n=incoming.get(name),owners=personal.filter(feature=>owns(feature,name));let result:Buffer|undefined,clash=false;
  if(controller(name)){if(!same(m,b)&&!same(m,n))throw Error('This app has changes to its desktop update controls. Keep using your current app and finish those changes with your local agent before updating.');result=n;}
  else if(same(m,b))result=n;
  else if(same(n,b)||same(m,n))result=m;
  else if(b&&m&&n){try{const decoder=new TextDecoder('utf8',{fatal:true}),merged=mergeDiff3(decoder.decode(m).split('\n'),decoder.decode(b).split('\n'),decoder.decode(n).split('\n'),{excludeFalseConflicts:true});clash=merged.conflict;result=clash?m:Buffer.from(merged.result.join('\n'));}catch{clash=true;result=m;}}
  else{clash=true;result=m;}
  if(clash){for(const feature of owners.length?owners:[undefined])conflict(feature,name);}
  const affected=owners.length?owners.map(feature=>feature.id):clash?['local-changes']:[];
  const dropped=affected.filter(id=>choices.get(id)==='use-official');
  if(dropped.length&&dropped.length===affected.length&&!controller(name))result=n;
  else if(clash||dropped.length)needsAgent=true;
  if(result)output.set(name,result);
 }
 for(const [id,choice] of choices){if(!conflicts.has(id)||!['keep-mine','use-official','combine'].includes(choice))throw Error('Choose how to handle each change in this update.');if(choice!=='use-official')needsAgent=true;}
 await rm(input.destination,{recursive:true,force:true});await mkdir(input.destination,{recursive:true});
 for(const [name,result] of output)await atomicWrite(join(input.destination,name),result);
 await atomicWrite(join(input.destination,'features.json'),JSON.stringify(catalog,null,2)+'\n');
 return {catalog,conflicts:[...conflicts.values()],needsAgent,preserved:personal.filter(feature=>choices.get(feature.id)!=='use-official').map(feature=>feature.id),removed:personal.filter(feature=>choices.get(feature.id)==='use-official').map(feature=>feature.id)};
}

export function verifyPreservedFeatures(expected:MergeResult,actual:Catalog){
 validateCatalog(actual);
 if(actual.appVersion!==expected.catalog.appVersion)throw Error('The update did not retain the new Draft version.');
 for(const feature of expected.catalog.features){const next=actual.features.find(f=>f.id===feature.id);if(!next||next.state!==feature.state)throw Error(`${feature.title} was not preserved. Your current app is unchanged.`);}
 for(const id of expected.preserved){const before=expected.catalog.features.find(feature=>feature.id===id),after=actual.features.find(feature=>feature.id===id);if(before?.origin!==after?.origin)throw Error('A personal change lost its identity. Keep it recorded in Your changes.');}
 for(const id of expected.removed)if(actual.features.some(feature=>feature.id===id&&!expected.catalog.features.some(f=>f.id===id)))throw Error('A change you chose to replace is still in the update.');
 for(const feature of actual.features.filter(feature=>feature.state==='active'))if(feature.dependsOn?.some(id=>!actual.features.some(next=>next.id===id&&next.state==='active')))throw Error(`${feature.title} needs a feature that is turned off. Keep your choice and adapt this feature to work without it.`);
}
