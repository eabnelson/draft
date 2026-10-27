// Runs on a fresh Mac runner with no release signing keychain or Apple credentials.
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {verify} from 'node:crypto';
import {macCommand,verifyMacApp} from './mac-distribution';
import {fileDigest} from '../desktop/native-update';
const repo=resolve(import.meta.dir,'..'),assets=resolve(process.argv[2]??join(repo,'release'));
const envelope=await Bun.file(join(assets,'draft-update.json')).json();
if(!verify(null,Buffer.from(envelope.payload),await readFile(join(repo,'update-public-key.pem')),Buffer.from(envelope.signature,'base64')))throw Error('The downloaded release manifest is not authentic.');
const release=JSON.parse(envelope.payload),team=process.env.APPLE_TEAM_ID;if(!team)throw Error('Choose the expected developer team.');
for(const artifact of [release.installer,release.desktop]){
 if(!artifact?.url)throw Error('The signed release is missing a download.');const name=new URL(artifact.url).pathname.split('/').at(-1)!;
 if(!/^[-a-zA-Z0-9_.]+$/.test(name)||await fileDigest(join(assets,name))!==artifact.sha256||(await Bun.file(join(assets,name)).size)!==artifact.size)throw Error('The downloaded installer does not match the signed release.');
}
// macOS exposes /var as a symlink. Tauri deliberately rejects an executable
// launched through it; use the canonical installation path, as /Applications does.
const stage=await realpath(await mkdtemp(join(tmpdir(),'draft-download-check-'))),mount=join(stage,'volume');await mkdir(mount);
const installer=join(assets,new URL(release.installer.url).pathname.split('/').at(-1)!);
await macCommand(['xcrun','stapler','validate',installer]);await macCommand(['/usr/sbin/spctl','--assess','--type','open','--context','context:primary-signature',installer]);
let mounted=false,child:ReturnType<typeof Bun.spawn>|undefined,output='';const data=join(stage,'profile');
const capture=async(stream:ReadableStream<Uint8Array>)=>{
 const reader=stream.getReader(),decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;output=(output+decoder.decode(value,{stream:true})).slice(-12000);}}
 finally{reader.releaseLock();}
};
async function startupDiagnostics(){
 const runtime=await Bun.file(join(data,'runtime-info.json')).json().catch(()=>undefined);
 const state=await Bun.file(join(data,'state.json')).json().catch(()=>undefined);
 console.log('DRAFT_STARTUP_CHECK',JSON.stringify({runtimeStarted:!!runtime,stateCreated:!!state,activeVersion:state?.activeVersion,appExit:child?.exitCode,output:output.replace(/([?&]token=|DRAFT_SESSION_TOKEN=)[a-f0-9]+/g,'$1<REDACTED>')}));
 if(runtime&&child&&runtime.hostPid===child.pid){
  const listeners=await macCommand(['/usr/sbin/lsof','-a','-p',String(runtime.runtimePid),'-iTCP','-sTCP:LISTEN','-Fn']).catch(()=>undefined);
  const port=listeners?.stdout.match(/127\.0\.0\.1:(\d+)/)?.[1];
  const process=await macCommand(['/bin/ps','eww','-p',String(runtime.runtimePid)]).catch(()=>undefined);
  const token=process?.stdout.match(/DRAFT_SESSION_TOKEN=([a-f0-9]{64})/)?.[1];
  if(port&&token){
   const origin=`http://127.0.0.1:${port}`,headers={Authorization:`Bearer ${token}`};
   const health=await fetch(origin+'/api/health',{headers}).then(r=>r.json()).catch(()=>undefined);
   const root=await fetch(origin+'/',{headers});const html=await root.text();const script=html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
   const asset=script?await fetch(new URL(script,origin),{headers}):undefined;
   console.log('DRAFT_STARTUP_HTTP',JSON.stringify({health,htmlStatus:root.status,moduleStatus:asset?.status,moduleType:asset?.headers.get('content-type')}));
  }
 }
}
try{
 const updater=join(stage,'updater');await mkdir(updater);
 await macCommand(['/usr/bin/ditto','-x','-k',join(assets,new URL(release.desktop.url).pathname.split('/').at(-1)!),updater]);
 await verifyMacApp(join(updater,'Draft.app'),team);
 await macCommand(['/usr/bin/hdiutil','attach',installer,'-nobrowse','-readonly','-mountpoint',mount]);mounted=true;
 const app=join(stage,'Applications/Draft.app');await mkdir(join(stage,'Applications'));
 await macCommand(['/usr/bin/ditto',join(mount,'Draft.app'),app]);
 await macCommand(['/usr/bin/xattr','-w','com.apple.quarantine',`0083;${Math.floor(Date.now()/1000).toString(16)};Safari;${crypto.randomUUID()}`,app]);
 await verifyMacApp(app,team);
 const codeHash=async(path:string)=>(await macCommand(['/usr/bin/codesign','-d','--verbose=4',path])).stderr.match(/^CDHash=(.+)$/m)?.[1];
 if(await codeHash(app)!==await codeHash(join(updater,'Draft.app')))throw Error('The installer and in-app update contain different applications.');
 if(process.env.CI!=='true')throw Error('Run fresh-profile app launch verification on the isolated CI Mac.');
 const runtime=join(app,'Contents/Resources/runtime'),workspace=join(stage,'editable-source');
 await macCommand(['/usr/bin/ditto',join(runtime,'source-template'),workspace]);
 await symlink(join(runtime,'node_modules'),join(workspace,'node_modules'),'dir');
 // This directory comes first in the host's tool lookup. Fail any accidental
 // system-Node dependency without nesting or weakening the feature sandbox.
 const node=join(homedir(),'.local/bin/node');await mkdir(dirname(node),{recursive:true});
 await writeFile(node,'#!/bin/sh\necho "External Node is unavailable in this installation check." >&2\nexit 123\n',{flag:'wx',mode:0o755});
 try{
  await macCommand(['/usr/bin/env',`PATH=${dirname(node)}:${process.env.PATH??'/usr/bin:/bin'}`,join(runtime,'bun'),'test',join(workspace,'tests'),join(workspace,'host-tests/official-update.test.ts')]);
 }finally{await rm(node);}
 console.log('BUNDLED_TOOLS_PASSED: document checks, personal feature builds, official merges and conflict choices using the shipped runtime without Node on PATH.');
 const info=await macCommand(['/usr/libexec/PlistBuddy','-c','Print :CFBundleExecutable',join(app,'Contents/Info.plist')]);
 const executable=info.stdout.trim();if(!/^[a-zA-Z0-9._-]+$/.test(executable))throw Error('Unexpected app executable.');
 const environment={...process.env,DRAFT_DATA_ROOT:data};for(const key of Object.keys(environment))if(key.startsWith('APPLE_')||key==='GH_TOKEN'||key==='GITHUB_TOKEN')delete environment[key as keyof typeof environment];
 const started=Date.now();child=Bun.spawn([join(app,'Contents/MacOS',executable)],{env:environment,stdout:'pipe',stderr:'pipe'});
 void capture(child.stdout as ReadableStream<Uint8Array>);void capture(child.stderr as ReadableStream<Uint8Array>);
 let launched=false;for(let i=0;i<300;i++){
  if(child.exitCode!==null)throw Error('The downloaded app stopped during first launch.');
  try{const library=await Bun.file(join(data,'Documents/library.json')).json();if(library.version===1&&library.drafts.length){launched=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!launched)throw Error('The fresh Mac launch did not open its local document library.');
 console.log('FIRST_LAUNCH_MS',Date.now()-started);
 await new Promise(resolve=>setTimeout(resolve,3000));if(child.exitCode!==null)throw Error('The app stopped after opening.');
 const state=await Bun.file(join(data,'state.json')).json();if(state.versions.find((version:any)=>version.id===state.activeVersion)?.catalog.appVersion!==release.version)throw Error('The fresh installation opened another app version.');
 console.log(`CLEAN_MAC_INSTALL_PASSED ${release.version}: authentic download, Apple approval, Gatekeeper, installed app, bundled feature tools, first launch, local writing.`);
}catch(error){await startupDiagnostics().catch(diagnostic=>console.log('DRAFT_STARTUP_CHECK',String(diagnostic)));throw error;}
finally{
 const runtime=await Bun.file(join(data,'runtime-info.json')).json().catch(()=>undefined);
 if(runtime&&child&&runtime.hostPid===child.pid&&runtime.runtimePid>1)try{process.kill(-runtime.runtimePid,'SIGTERM');}catch{}
 try{child?.kill('SIGTERM');}catch{}if(child)await child.exited;
 if(mounted)await macCommand(['/usr/bin/hdiutil','detach',mount]).catch(error=>console.warn(String(error)));await rm(stage,{recursive:true,force:true});
}
