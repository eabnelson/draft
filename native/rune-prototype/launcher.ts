import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,chmod,rm,open} from 'node:fs/promises';
import {startPrototypeHost} from './host';
import {atomicWrite,readJSON,exists} from '../../desktop/files';
import {openExternalLink} from '../../desktop/links';
import {migrateLegacyLibrary} from '../../desktop/native-migration';

const runtime=resolve(process.env.DRAFT_RUNTIME_ROOT??import.meta.dir);
const profileAt=process.argv.indexOf('--profile');
const root=resolve((profileAt>=0?process.argv[profileAt+1]:undefined)??process.env.DRAFT_NATIVE_DATA_ROOT??(process.platform==='darwin'?join(homedir(),'Library/Application Support/Draft Native'):join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'draft-native')));
if(process.platform==='darwin'&&profileAt<0&&!process.env.DRAFT_NATIVE_DATA_ROOT)await migrateLegacyLibrary(join(homedir(),'Library/Application Support/Draft'),root);
await mkdir(root,{recursive:true,mode:0o700});
const instance=join(root,'native-instance.json'),lock=join(root,'native.lock');
const activate=async()=>{
  try{const saved=await readJSON<{url:string;token:string}>(instance);
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(saved.url))return false;
    const response=await fetch(saved.url+'/desktop/activate',{method:'POST',headers:{authorization:`Bearer ${saved.token}`,'content-type':'application/json'},body:JSON.stringify({capture:process.argv.includes('--capture')}),signal:AbortSignal.timeout(1500)});
    return response.ok;
  }catch{return false;}
};
if(await activate())process.exit(0);
try{const file=await open(lock,'wx',0o600);await file.writeFile(String(process.pid));await file.close();}
catch{
  const pid=Number(await Bun.file(lock).text());let alive=false;try{process.kill(pid,0);alive=true;}catch{}
  if(alive){for(let i=0;i<20;i++){await Bun.sleep(250);if(await activate())process.exit(0);}throw Error('Draft is still starting. Try again in a moment.');}
  await rm(lock,{force:true});const file=await open(lock,'wx',0o600);await file.writeFile(String(process.pid));await file.close();
}
const token=crypto.randomUUID()+crypto.randomUUID();
const host=await startPrototypeHost(root,token,{runtime,template:join(runtime,'source-template'),packaged:true});
const url=`http://127.0.0.1:${host.server.port}`;
await atomicWrite(instance,JSON.stringify({url,token}));await chmod(instance,0o600);
if(process.argv.includes('--capture')){const response=await fetch(url+'/new',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error('Draft could not prepare a new draft.');}
const bundled=resolve(process.env.DRAFT_NATIVE_EXECUTABLE!);
const recovery=async(message:string)=>{
  await atomicWrite(join(root,'native-launch-error.txt'),message);
  // The fixed host's UI can discard a failed candidate or roll back independently.
  await openExternalLink(`${url}/updates?token=${encodeURIComponent(token)}`);
};
let menu:ReturnType<typeof Bun.spawn>|undefined;
const menuTimer=process.platform==='darwin'?setInterval(()=>{
  if(host.desktop.preferences.menuBarIcon&&!menu){
    menu=Bun.spawn([join(runtime,'draft-menu')],{stdin:'pipe',stdout:'pipe',stderr:'ignore'});
    const active=menu;void(async()=>{for await(const chunk of active.stdout as any){for(const action of new TextDecoder().decode(chunk).trim().split('\n')){await fetch(url+'/desktop/activate',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,capture:action==='new'})});}}})();
  }else if(!host.desktop.preferences.menuBarIcon&&menu){menu.kill();menu=undefined;}
},500):undefined;
let stopping=false,child:ReturnType<typeof Bun.spawn>|undefined;
process.on('SIGTERM',()=>{stopping=true;child?.kill('SIGTERM');});
process.on('SIGINT',()=>{stopping=true;child?.kill('SIGTERM');});
try{
  let updates=await host.control.ready();
  for(let attempts=0;!stopping&&attempts<4;attempts++){
    let executable=join(updates.active.dist,'draft-native');
    const rendererBundle=join(updates.active.dist,'native-renderer.app/Contents/MacOS/draft-native');
    if(process.platform==='darwin')executable=await exists(rendererBundle)?rendererBundle:bundled;
    else if(!await exists(executable))executable=bundled;
    child=Bun.spawn([executable,...process.argv.slice(2).filter((arg,index,all)=>arg!=='--capture'&&arg!=='--profile'&&all[index-1]!=='--profile')],{env:{...process.env,DRAFT_PACKAGED:"1",DRAFT_RUNE_HOST:url,DRAFT_RUNE_TOKEN:token,DRAFT_RUNE_DATA_ROOT:root},stdout:'inherit',stderr:'inherit'});
    const code=await child.exited;
    if(stopping)break;
    if(host.control.restart){
      host.control.restart=false;
      if(updates.state.nativeInstallPlan){
        const helper=join(runtime,'draft-install');
        const install=Bun.spawn([helper,updates.state.nativeInstallPlan],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});install.unref();break;
      }
      continue;
    }
    if(code===0)break;
    await updates.abortActivation();
    if(executable===bundled){await recovery(`Native renderer exited with ${code}. Your writing is stored in ${join(root,'Drafts')}.`);await new Promise<void>(resolve=>{const timer=setInterval(()=>{if(host.control.restart){clearInterval(timer);resolve();}},500);process.once('SIGTERM',()=>{clearInterval(timer);resolve();});});host.control.restart=false;continue;}
  }
}finally{if(menuTimer)clearInterval(menuTimer);menu?.kill();await host.close();await rm(instance,{force:true});await rm(lock,{force:true});}
