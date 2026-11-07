import {cp,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {atomicWrite,exists,readJSON} from './files';

// Import only writing into a new native profile. Never replace an existing
// library, reuse the old application state, or silently reconnect cloud sync.
export async function migrateLegacyLibrary(legacy:string,destination:string){
  if(await exists(destination)||!await exists(join(legacy,'Drafts/library.json')))return false;
  const runtime=await readJSON<{hostPid?:number;runtimePid?:number}>(join(legacy,'runtime-info.json')).catch(()=>undefined);
  for(const pid of [runtime?.hostPid,runtime?.runtimePid]){
    if(!pid||pid<=1)continue;
    let alive=false;try{process.kill(pid,0);alive=true;}catch{}
    if(alive)throw Error('Quit the previous Draft app before opening the new version so your latest writing can be imported.');
  }
  await mkdir(dirname(destination),{recursive:true});
  const stage=await mkdtemp(join(dirname(destination),'.draft-native-import-'));
  try{
    for(const name of ['Drafts','Documents','Exports','Recovery'])if(await exists(join(legacy,name)))await cp(join(legacy,name),join(stage,name),{recursive:true,errorOnExist:true,force:false});
    await atomicWrite(join(stage,'legacy-import.json'),JSON.stringify({schemaVersion:1,importedAt:new Date().toISOString(),source:legacy,writingCopied:true,syncRequiresReconnect:true})+'\n');
    if(await exists(destination))return false;
    await rename(stage,destination);return true;
  }finally{await rm(stage,{recursive:true,force:true});}
}
