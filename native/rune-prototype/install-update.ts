// Linux counterpart of native/InstallUpdate.swift. A separate process completes the app swap
// after Draft has saved and exited, then confirms the new app starts or puts the old one back.
// It owns no document migration: writing remains in the existing document store.
import {readFile,writeFile,rename,rm,mkdir,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash,verify} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {linuxAppInfo,previousAppName} from '../../desktop/native-update';

type Plan={dataRoot?:string;appPath?:string;updateId?:string;parentPid?:number;bundleId?:string;targetHost?:string;previousHost?:string;action?:string;archive?:string;envelope?:{payload?:string;signature?:string};backup?:string;target?:string;previous?:string;previousOfficial?:string};
const fail=(message:string):never=>{throw Error(message);};
const ensure=(condition:unknown,message:string)=>{if(!condition)fail(message);};
const readJSON=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
async function writeJSON(value:unknown,path:string){
  await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(args:string[]){
  const child=Bun.spawn(args,{stdout:'ignore',stderr:'pipe'});const error=await new Response(child.stderr).text();
  if(await child.exited)fail(error.trim()||'The desktop update could not be prepared.');
}

/// Exchange two folders on the same filesystem in one step, so the app path always holds an app.
/// Filesystems without renameat2's exchange fall back to two renames with a restore.
async function exchange(app:string,replacement:string){
  try{
    const {dlopen,FFIType,ptr}=await import('bun:ffi');
    const libc=dlopen('libc.so.6',{renameat2:{args:[FFIType.i32,FFIType.ptr,FFIType.i32,FFIType.ptr,FFIType.u32],returns:FFIType.i32}});
    try{
      const a=Buffer.from(app+'\0'),b=Buffer.from(replacement+'\0');
      if(libc.symbols.renameat2(-100,ptr(a),-100,ptr(b),2)===0)return;
    }finally{libc.close();}
  }catch{}
  const aside=replacement+'.previous';
  await rename(app,aside);
  try{await rename(replacement,app);}catch(error){await rename(aside,app);throw error;}
  await rename(aside,replacement);
}
function launch(app:string,root:string){
  const environment:Record<string,string|undefined>={...process.env,DRAFT_DATA_ROOT:root,DRAFT_NATIVE_DATA_ROOT:root};
  for(const key of ['DRAFT_RUNTIME_ROOT','DRAFT_TEMPLATE_ROOT','DRAFT_NATIVE_EXECUTABLE','DRAFT_APP_PATH','DRAFT_LAUNCHER_EXECUTABLE'])delete environment[key];
  const child=spawn(join(app,'bin/draft'),[],{env:environment,detached:true,stdio:'ignore'});child.unref();return child;
}
async function stop(child:ChildProcess|undefined,root:string){
  if(!child?.pid)return;
  const runtime=await readJSON(join(root,'runtime-info.json')).catch(()=>undefined);
  if(runtime?.hostPid===child.pid&&Number.isInteger(runtime.runtimePid)&&runtime.runtimePid>1)try{process.kill(-runtime.runtimePid,'SIGTERM');}catch{}
  if(child.exitCode===null&&child.signalCode===null){
    try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}
    for(let i=0;i<50&&alive(child.pid);i++)await sleep(100);
  }
}

export async function installUpdate(planArgument:string|undefined,runtime:string){
  let plan:Plan={},root:string|undefined,app:string|undefined,child:ChildProcess|undefined,status:string|undefined;
  let movedOriginal=false,installedNew=false,savedOriginal:string|undefined,parent:number|undefined;
  try{
    ensure(planArgument,'Choose a prepared update.');
    const planPath=resolve(planArgument!);plan=await readJSON(planPath);
    const {dataRoot,appPath,updateId:id,parentPid,bundleId,targetHost,action}=plan;
    if(!dataRoot||!appPath||!id||!parentPid||!bundleId||!targetHost||!action)fail('The update plan is incomplete.');
    ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id!)&&Number.isInteger(parentPid)&&parentPid!>1&&parentPid!==process.pid,'The update identity is invalid.');
    const data=resolve(dataRoot!),application=resolve(appPath!);
    ensure(planPath===join(data,'NativeUpdates',id!,'install-plan.json'),'The update plan is outside Draft’s update folder.');
    ensure(resolve(runtime,'../..')===application,'The update belongs to another application.');
    ensure((await linuxAppInfo(application)).bundleId===bundleId,'The application identity has changed.');
    const publicKey=await readFile(join(runtime,'source-template/update-public-key.pem'),'utf8');
    root=data;app=application;parent=parentPid;
    status=join(data,'NativeUpdates',id!,'status.json');
    const previous=join(dirname(application),previousAppName(id!,'linux'));
    await writeJSON({phase:'installing',helperPid:process.pid,backup:previous},status);
    for(let i=0;i<150&&alive(parentPid!);i++)await sleep(100);
    ensure(!alive(parentPid!),'Draft is still saving. The update was left unapplied.');
    const staging=join(dirname(application),`.Draft-update-${id}`);
    await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});
    try{
      let replacement:string;
      if(action==='install'){
        const payload=plan.envelope?.payload,signature=plan.envelope?.signature;
        if(typeof payload!=='string'||typeof signature!=='string'||!plan.archive)fail('The update signature is missing.');
        ensure(verify(null,Buffer.from(payload!),publicKey,Buffer.from(signature!,'base64')),'The update signature is invalid.');
        const manifest=JSON.parse(payload!);
        const build=Array.isArray(manifest.linux)?manifest.linux.find((build:any)=>build?.arch===process.arch&&build?.bundleId===bundleId):undefined;
        if(!build?.desktop||typeof build.desktop.sha256!=='string'||!Number.isSafeInteger(build.desktop.size))fail('The signed update is incomplete.');
        ensure(manifest.nativeHostVersion===targetHost,'The update does not match this app.');
        const bytes=await readFile(plan.archive!);
        ensure(bytes.length===build.desktop.size&&createHash('sha256').update(bytes).digest('hex')===build.desktop.sha256,'The update download has changed.');
        await run(['tar','-xzf',plan.archive!,'-C',staging,'--no-same-owner']);
        const entries=await readdir(staging);ensure(entries.length===1&&entries[0]==='Draft','The desktop update is incomplete.');
        replacement=join(staging,'Draft');
      }else if(action==='rollback'){
        const saved=resolve(plan.backup??fail('The previous app is missing.'));
        ensure(saved.startsWith(join(dirname(application),'.Draft-previous-'))||saved.startsWith(join(data,'Backups')+'/'),'The previous app is outside the recovery folders.');
        replacement=join(staging,'Draft');await run(['cp','-a',saved,replacement]);
      }else fail('Unknown update action.');
      const info=await linuxAppInfo(replacement!);
      ensure(info.bundleId===bundleId&&info.version===targetHost,'The desktop version does not match this update.');
      const previousIndex=join(data,'NativeUpdates/previous.json');
      const oldBackup=(await readJSON(previousIndex).catch(()=>undefined))?.path;
      await writeJSON({phase:'installing',helperPid:process.pid,backup:previous,recovery:replacement!},status);
      await exchange(application,replacement!).catch(()=>fail('The app could not be replaced. Your current app is unchanged.'));
      movedOriginal=true;installedNew=true;savedOriginal=replacement!;
      await rm(previous,{recursive:true,force:true});await rename(replacement!,previous);savedOriginal=previous;
      child=launch(application,data);
      let confirmed=false;
      for(let i=0;i<300;i++){
        const state=await readJSON(join(data,'state.json')).catch(()=>undefined);
        if(state&&state.pendingActivation===undefined&&state.activeVersion===plan.target&&Array.isArray(state.updates)&&state.updates.some((update:any)=>update?.id===id&&update?.state==='applied')){confirmed=true;break;}
        if(child.exitCode!==null||child.signalCode!==null)break;
        await sleep(100);
      }
      ensure(confirmed,'The new app could not finish starting.');
      await writeJSON({path:previous,version:plan.previousHost??''},previousIndex);
      await writeJSON({phase:'complete',backup:previous},status);
      if(typeof oldBackup==='string'&&oldBackup!==previous&&oldBackup.startsWith(join(dirname(application),'.Draft-previous-')))await rm(oldBackup,{recursive:true,force:true});
    }finally{await rm(staging,{recursive:true,force:true});}
    return 0;
  }catch(error){
    if(parent&&alive(parent)){
      if(status)await writeJSON({phase:'blocked',message:'Draft is still saving. Try the update again.'},status).catch(()=>{});
      return 1;
    }
    if(!root||!app){console.error('Draft could not read the prepared update.');return 1;}
    await stop(child,root);
    if(installedNew)await rm(app,{recursive:true,force:true}).catch(()=>{});
    if(movedOriginal&&savedOriginal)await rename(savedOriginal,app).catch(()=>{});
    const statePath=join(root,'state.json'),state=await readJSON(statePath).catch(()=>undefined);
    if(state&&typeof state==='object'){
      state.activeVersion=plan.previous;state.officialVersion=plan.previousOfficial;delete state.pendingActivation;delete state.nativeInstallPlan;
      const update=Array.isArray(state.updates)?state.updates.find((update:any)=>update?.id===plan.updateId):undefined;
      if(update){update.state='failed';update.stage='Your previous app is back';update.error='The update couldn’t start. Draft restored your previous app. Your writing is safe.';}
      await writeJSON(state,statePath).catch(()=>{});
    }
    if(status)await writeJSON({phase:'restored',message:'Your previous app is back.',detail:String(error)},status).catch(()=>{});
    try{launch(app,root);}catch{}
    return 0;
  }
}

if(import.meta.main)process.exit(await installUpdate(process.argv[2],import.meta.dir));
