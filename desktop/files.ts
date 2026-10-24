import {mkdir,open,readFile,rename,stat,realpath,cp,readdir,readlink} from 'node:fs/promises';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

export async function atomicWrite(path:string,value:string|Uint8Array){
  await mkdir(dirname(path),{recursive:true});const temp=`${path}.${crypto.randomUUID()}.tmp`;
  const file=await open(temp,'wx',0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}
  await rename(temp,path);
}
export async function readJSON<T>(path:string):Promise<T>{return JSON.parse(await readFile(path,'utf8'));}
export async function exists(path:string){try{await stat(path);return true;}catch{return false;}}
export function within(root:string,path:string){const r=relative(resolve(root),resolve(path));return r===''||(!r.startsWith('..')&&!isAbsolute(r));}
export function safeId(value:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(value))throw Error('Invalid document or version identity.');return value;}
const ignoredSourcePath=(path:string)=>path.split(/[\\/]/).some(name=>['node_modules','.git','dist','resources','target','release','binaries','.draft-upstream','gen','.build-cache','.DS_Store'].includes(name)||name.startsWith('.env'));
export async function copySource(source:string,target:string){
  const filter=async(path:string)=>!ignoredSourcePath(relative(source,path));
  await mkdir(target,{recursive:true});
  for(const entry of await readdir(source)){const path=join(source,entry);if(await filter(path))await cp(path,join(target,entry),{recursive:true,filter});}
}
export async function sourceHash(root:string):Promise<string>{
  const hash=createHash('sha256');
  async function visit(dir:string){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(dir,entry.name),r=relative(root,path).replaceAll('\\','/');
    if(ignoredSourcePath(r))continue;
    if(entry.isSymbolicLink())throw Error(`Source contains a symlink: ${r}`);
    if(entry.isDirectory())await visit(path);else if(entry.isFile()){hash.update(r);hash.update(await readFile(path));}
  }}await visit(root);return hash.digest('hex');
}
export async function assertContainedFiles(root:string){
  const realRoot=await realpath(root);
  async function visit(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.name==='node_modules')continue;if(entry.isSymbolicLink())throw Error('A generated update contains a symlink outside its source files.');if(!within(realRoot,await realpath(p)))throw Error('A generated file escaped the update workspace.');if(entry.isDirectory())await visit(p);}}
  await visit(root);
}
