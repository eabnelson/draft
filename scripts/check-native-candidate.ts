// Runs inside the host's build sandbox. Dependencies and the toolchain are read
// from the local installation; all writable Cargo state belongs to this candidate.
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,symlink,copyFile,writeFile,rm} from 'node:fs/promises';
import {exists} from '../desktop/files';
const root=resolve(import.meta.dir,'..'),home=join(root,'.build-cache/cargo');
await mkdir(home,{recursive:true});
const installed=process.env.CARGO_HOME??join(homedir(),'.cargo');
for(const folder of ['registry','git'])if(await exists(join(installed,folder))&&!await exists(join(home,folder)))await symlink(join(installed,folder),join(home,folder));
const env={...process.env,CARGO_HOME:home,CARGO_TARGET_DIR:join(root,'native/rune-prototype/target'),CARGO_NET_OFFLINE:'true',PATH:[join(homedir(),'.cargo/bin'),process.env.PATH??''].join(':')};
try{
for(const args of [['fmt','--manifest-path','native/rune-prototype/Cargo.toml','--','--check'],['clippy','--manifest-path','native/rune-prototype/Cargo.toml','--locked','--','-D','warnings'],['test','--manifest-path','native/rune-prototype/Cargo.toml','--locked'],['build','--manifest-path','native/rune-prototype/Cargo.toml','--locked','--release']]){
  const child=Bun.spawn(['cargo',...args],{cwd:root,env,stdout:'inherit',stderr:'inherit'});if(await child.exited)throw Error('The native Cargo check failed.');
}
const check=Bun.spawn([process.execPath,'native/rune-prototype/run.ts','--check','--release'],{cwd:root,env,stdout:'inherit',stderr:'inherit'});if(await check.exited)throw Error('The native interaction check failed.');
await mkdir(join(root,'dist'),{recursive:true});await copyFile(join(root,'native/rune-prototype/target/release/draft-rune-prototype'),join(root,'dist/draft-native'));

if(process.platform==='darwin'){
  const app=join(root,'dist/native-renderer.app'),contents=join(app,'Contents');
  await mkdir(join(contents,'MacOS'),{recursive:true});
  await copyFile(join(root,'dist/draft-native'),join(contents,'MacOS/draft-native'));
  await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>draft-native</string><key>CFBundleIdentifier</key><string>com.studiofour.draft.native</string><key>CFBundleName</key><string>Draft Native</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>');
  const sign=Bun.spawn(['/usr/bin/codesign','--force','--sign','-',app],{stdout:'inherit',stderr:'inherit'});if(await sign.exited)throw Error('The prepared native renderer could not be signed.');
}

}finally{await rm(home,{recursive:true,force:true});}
