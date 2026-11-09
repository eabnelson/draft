// Runs on a fresh Linux runner with no signing key: checks a release's Linux download the way a
// user and the in-app updater will see it, before the release is published.
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink,realpath,cp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {verify} from 'node:crypto';
import {fileDigest,linuxAppInfo} from '../desktop/native-update';
import type {ReleaseManifest} from '../desktop/official-release';

const repo=resolve(import.meta.dir,'..'),assets=resolve(process.argv[2]??join(repo,'release')),arch=process.argv[3]??process.arch;
async function run(args:string[],options:{env?:Record<string,string|undefined>;cwd?:string;timeout?:number}={}){
 const child=Bun.spawn(args,{env:options.env??process.env,cwd:options.cwd,stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),options.timeout??120000);
 const [stdout,stderr]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
 if(await child.exited)throw Error(`${args[0]} failed:\n${(stdout+stderr).slice(-8000)}`);return stdout;
}
const envelope=await Bun.file(join(assets,'draft-update.json')).json();
if(!verify(null,Buffer.from(envelope.payload),await readFile(join(repo,'update-public-key.pem')),Buffer.from(envelope.signature,'base64')))throw Error('The downloaded release manifest is not authentic.');
const release=JSON.parse(envelope.payload) as ReleaseManifest;
const build=release.linux?.find(build=>build.arch===arch&&build.bundleId==='com.studiofour.draft.native');
if(!build)throw Error(`The signed release has no Linux ${arch} build.`);
const local=async(artifact:{url:string;sha256:string;size:number})=>{
 const name=new URL(artifact.url).pathname.split('/').at(-1)!,path=join(assets,name);
 if(!/^[-a-zA-Z0-9_.]+$/.test(name)||await fileDigest(path)!==artifact.sha256||Bun.file(path).size!==artifact.size)throw Error('The downloaded Linux build does not match the signed release.');
 return path;
};
const archive=await local(build.desktop),source=await local(build.source);
// Under the home folder, as a real install is: the build sandbox hides /tmp from personal-feature builds.
const stage=await realpath(await mkdtemp(join(homedir(),'draft-linux-download-')));
try{
 // Unpack where a person would, then check what the updater checks.
 const applications=join(stage,'Applications');await mkdir(applications);
 await run(['tar','-xzf',archive,'-C',applications,'--no-same-owner']);
 const app=join(applications,'Draft'),info=await linuxAppInfo(app);
 if(info.bundleId!=='com.studiofour.draft.native'||info.version!==release.nativeHostVersion||release.version!==release.nativeHostVersion)throw Error('The Linux build is not this release.');
 const sourceCheck=join(stage,'source');await mkdir(sourceCheck);await run(['tar','-xzf',source,'-C',sourceCheck,'./features.json']);
 if((await Bun.file(join(sourceCheck,'features.json')).json()).appVersion!==release.version)throw Error('The Linux source does not match this release.');
 for(const name of ['bin/draft','bin/draft-native','lib/draft/bun','lib/draft/draft-install','install-desktop'])await run(['test','-x',join(app,name)]);
 console.log('LINUX_DOWNLOAD_AUTHENTIC: signed manifest, matching hashes, app identity and version.');

 // The desktop shortcut a person adds after unpacking.
 const xdg=join(stage,'xdg');await run([join(app,'install-desktop')],{env:{...process.env,XDG_DATA_HOME:xdg}});
 const entry=await readFile(join(xdg,'applications/com.studiofour.draft.native.desktop'),'utf8');
 if(!entry.includes(join(app,'bin/draft')))throw Error('The desktop shortcut does not open the unpacked app.');

 // Personal features and official merges use only the shipped tools; fail any use of system Node.
 const runtime=join(app,'lib/draft'),workspace=join(stage,'editable-source');
 await cp(join(runtime,'source-template'),workspace,{recursive:true,verbatimSymlinks:true});
 await symlink(join(runtime,'node_modules'),join(workspace,'node_modules'),'dir');
 const node=join(homedir(),'.local/bin/node');await mkdir(dirname(node),{recursive:true});
 await writeFile(node,'#!/bin/sh\necho "External Node is unavailable in this installation check." >&2\nexit 123\n',{flag:'wx',mode:0o755});
 // Merging personal changes builds inside bubblewrap. Where the system blocks its namespaces,
 // personal features can't build, but official updates and everything else still must work.
 const sandbox=Bun.spawnSync(['bwrap','--ro-bind','/','/','--dev','/dev','--proc','/proc','true']).exitCode===0;
 try{
  const scratch=join(stage,'tmp');await mkdir(scratch);
  const env={...process.env,TMPDIR:scratch,PATH:`${dirname(node)}:${process.env.PATH??'/usr/bin:/bin'}`};
  await run([join(runtime,'bun'),'test',join(workspace,'tests'),join(workspace,'host-tests/linux-installer.test.ts')],{env,timeout:600000});
  await run([join(runtime,'bun'),'test',join(workspace,'host-tests/official-update.test.ts'),...(sandbox?[]:['--test-name-pattern','without personal changes'])],{env,timeout:600000});
 }finally{await rm(node);}
 console.log(sandbox?'BUNDLED_TOOLS_PASSED: document checks, official merges with personal features, and the Linux installer using the shipped runtime.':'BUNDLED_TOOLS_PASSED: document checks, official updates and the Linux installer using the shipped runtime. Personal-feature merges were skipped: bubblewrap cannot create namespaces here.');

 // The packaged app renders its writing page and passes its interaction checks, without a display.
 const environment:Record<string,string|undefined>={...process.env,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??'/tmp'};
 for(const key of Object.keys(environment))if(key==='GH_TOKEN'||key==='GITHUB_TOKEN')delete environment[key];
 const frame=join(stage,'native-frame.png'),tree=join(stage,'native-frame.json');
 await run([join(app,'bin/draft'),'--profile',join(stage,'render-profile'),'--at','5','--snap',frame,'--tree',tree],{env:environment,timeout:120000});
 const rendered=await Bun.file(tree).json();
 if(!rendered.elements.some((element:any)=>element.key==='draft-content')||!rendered.elements.some((element:any)=>element.role==='textbox')||Bun.file(frame).size<1000)throw Error('The Linux writing interface did not render.');
 await run([join(app,'bin/draft'),'--profile',join(stage,'interaction-profile'),'--verify'],{env:environment,timeout:300000});
 console.log(`CLEAN_LINUX_INSTALL_PASSED ${release.version} (${arch}): authentic download, desktop shortcut, bundled tools, rendered writing interface and interaction checks.`);
}finally{await rm(stage,{recursive:true,force:true});}
