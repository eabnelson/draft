import {join,resolve} from 'node:path';
import {mkdir,mkdtemp,rm,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {startPrototypeHost} from './host';

const root=resolve(import.meta.dir),args=process.argv.slice(2);
const check=args.includes('--check'),release=args.includes('--release'),nativeArgs=args.filter(x=>!['--check','--release'].includes(x));
const build=Bun.spawn(['cargo','build','--manifest-path',join(root,'Cargo.toml'),'--locked',...(release?['--release']:[])],{stdout:'inherit',stderr:'inherit'});
if(await build.exited)process.exit(1);
const data=check?await mkdtemp(join(tmpdir(),'draft-rune-check-')):resolve(process.env.DRAFT_RUNE_DATA_ROOT??join(root,'scratch'));
await mkdir(data,{recursive:true});await mkdir(join(root,'artifacts'),{recursive:true});
const token=crypto.randomUUID()+crypto.randomUUID();
const {server,close}=await startPrototypeHost(data,token);
let executable=join(root,`target/${release?'release':'debug'}/draft-rune-prototype`);
if(process.platform==='darwin'&&!check&&nativeArgs.length===0){
  const contents=join(root,'artifacts/Draft Rune Prototype.app/Contents');await mkdir(join(contents,'MacOS'),{recursive:true});
  await copyFile(executable,join(contents,'MacOS/draft-rune-prototype'));
  await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>draft-rune-prototype</string><key>CFBundleIdentifier</key><string>com.studiofour.draft.rune-prototype</string><key>CFBundleName</key><string>Draft Rune Prototype</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>');
  executable=join(contents,'MacOS/draft-rune-prototype');
}
const child=Bun.spawn([executable,...(check?['--verify']:nativeArgs)],{stdout:'inherit',stderr:'inherit',env:{...process.env,DRAFT_RUNE_HOST:`http://127.0.0.1:${server.port}`,DRAFT_RUNE_TOKEN:token,DRAFT_RUNE_DATA_ROOT:data}});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{process.exitCode=await child.exited;}finally{await close();if(check)await rm(data,{recursive:true,force:true});}
