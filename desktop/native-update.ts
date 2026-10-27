import {join,dirname,resolve} from 'node:path';
import {access,readFile,readdir,mkdir,rm,rename} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {ReleaseChannel,type SignedRelease} from './official-release';
import {atomicWrite,exists,readJSON} from './files';
import type {NativePackage,Version,Update} from './types';

async function command(args:string[]){const child=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});const [output,error]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);if(await child.exited)throw Error(error||'The desktop update could not be checked.');return output.trim();}
export async function fileDigest(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export class NativeUpdates {
 constructor(readonly root:string,readonly appPath:string,readonly channel:ReleaseChannel){}
 async stage(id:string,release:SignedRelease,signal:AbortSignal,onProgress?:(received:number,total:number)=>void):Promise<NativePackage>{
  try{await access(dirname(this.appPath),constants.W_OK);}catch{throw Error('Move Draft to Applications before installing this update.');}
  const folder=join(this.root,'NativeUpdates',id),archive=join(folder,'desktop.zip'),expanded=join(folder,'check');
  await this.channel.download(release.desktop,archive,signal,onProgress);
  try{
   await mkdir(expanded,{recursive:true});await command(['/usr/bin/ditto','-x','-k',archive,expanded]);
   const apps=(await readdir(expanded)).filter(name=>name.endsWith('.app'));if(apps.length!==1)throw Error('The desktop download is incomplete.');
   const app=join(expanded,apps[0]),info=join(app,'Contents/Info.plist');
   if(await command(['/usr/libexec/PlistBuddy','-c','Print :CFBundleIdentifier',info])!==release.desktop.bundleId||await command(['/usr/libexec/PlistBuddy','-c','Print :CFBundleShortVersionString',info])!==release.nativeHostVersion)throw Error('The desktop download does not match this update.');
   await command(['/usr/bin/codesign','--verify','--deep','--strict',app]);
  }finally{await rm(expanded,{recursive:true,force:true});}
  return {archive,release};
 }
 async installPlan(update:Update,target:Version,previous:Version){
  if(!update.native)throw Error('Download the desktop update again before installing it.');
  if(await fileDigest(update.native.archive)!==update.native.release.desktop.sha256)throw Error('The desktop download has changed. Download it again before updating.');
  return this.writePlan(update,target,previous,{action:'install',archive:resolve(update.native.archive),envelope:update.native.release.envelope});
 }
 async rollbackPlan(update:Update,target:Version,previous:Version){
  const backup=await readJSON<{path:string;version:string}>(join(this.root,'NativeUpdates','previous.json')).catch(()=>undefined);
  if(!backup||backup.version!==target.hostVersion||!await exists(backup.path))throw Error('The previous desktop version is not available on this Mac.');
  return this.writePlan(update,target,previous,{action:'rollback',backup:backup.path});
 }
 private async writePlan(update:Update,target:Version,previous:Version,operation:object){
  const path=join(this.root,'NativeUpdates',update.id,'install-plan.json');
  await atomicWrite(path,JSON.stringify({schemaVersion:1,...operation,appPath:resolve(this.appPath),dataRoot:resolve(this.root),updateId:update.id,target:target.id,previous:previous.id,previousOfficial:previous.officialId,targetHost:target.hostVersion,previousHost:previous.hostVersion??previous.catalog.appVersion,bundleId:this.channel.options.bundleId??'com.eriknelson.draft',parentPid:process.ppid,runtimePid:process.pid},null,2));return path;
 }
}

// Startup can finish an interrupted transaction even if the installer exited
// after the atomic exchange but before recording the previous app for Undo.
export async function rememberPreviousApp(root:string,planPath:string,helperStopped=false){
 const plan=await readJSON<{appPath:string;updateId:string;previousHost:string}>(planPath);
 if(!plan.appPath||!plan.updateId||!plan.previousHost||!/^[a-f0-9-]{36}$/i.test(plan.updateId))return;
 const backup=join(dirname(plan.appPath),`.Draft-previous-${plan.updateId}.app`);
 if(!await exists(backup)&&helperStopped){
  const status=await readJSON<{recovery?:string}>(join(dirname(planPath),'status.json')).catch(()=>undefined);
  const recovery=status?.recovery;
  if(recovery&&resolve(recovery).startsWith(join(dirname(plan.appPath),`.Draft-update-${plan.updateId}`)+'/')&&await exists(recovery))await rename(recovery,backup);
 }
 if(await exists(backup))await atomicWrite(join(root,'NativeUpdates/previous.json'),JSON.stringify({path:backup,version:plan.previousHost}));
}
