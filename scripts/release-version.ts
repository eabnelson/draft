import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export const versionFiles=['package.json','features.json','native/rune-prototype/Cargo.toml','native/rune-prototype/Cargo.lock','desktop/updates.ts'] as const;
export function nextPreviewVersion(base:string,tags:string[]){
 const match=base.match(/^(\d+\.\d+\.\d+)-alpha\.(\d+)$/);
 if(!match)throw Error('Automatic main releases require an alpha.N package version. Stable releases must be tagged explicitly.');
 const versions=tags.map(tag=>tag.replace(/^v/,'')).filter(version=>/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version));
 const latest=versions.reduce((a,b)=>Bun.semver.order(a,b)>0?a:b,base);
 if(latest!==base&&!latest.startsWith(`${match[1]}-alpha.`))throw Error('Advance package.json to the next alpha series before releasing main.');
 const number=Math.max(Number(match[2]),...versions.filter(version=>new RegExp(`^${match[1].replaceAll('.','\\.')}-alpha\\.\\d+$`).test(version)).map(version=>Number(version.split('.').at(-1))));
 return `${match[1]}-alpha.${number+1}`;
}
export async function versionContents(root:string,version:string){
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error('Invalid release version.');
 const files:Record<string,string>={};
 for(const name of versionFiles){
  const before=await readFile(join(root,name),'utf8');let after:string;
  if(name.endsWith('.json')){const value=JSON.parse(before);value[name==='features.json'?'appVersion':'version']=version;after=JSON.stringify(value,null,2)+'\n';}
  else{
   const pattern=name.endsWith('Cargo.lock')?/(\[\[package\]\]\nname = "draft-rune-prototype"\nversion = ")[^"]+("\n)/:name.endsWith('Cargo.toml')?/(\[package\]\nname = "draft-rune-prototype"\nversion = ")[^"]+("\n)/:/(const nativeHostVersion=')[^']+(';)/;
   if(!pattern.test(before))throw Error(`Could not locate the release version in ${name}.`);
   after=before.replace(pattern,(_,prefix,suffix)=>prefix+version+suffix);
  }
  files[name]=after;
 }
 return files;
}
export async function stampVersion(root:string,version:string){for(const [name,content] of Object.entries(await versionContents(root,version)))await writeFile(join(root,name),content);}
if(import.meta.main)await stampVersion(resolve(import.meta.dir,'..'),process.argv[2]?.replace(/^v/,'')??'');
