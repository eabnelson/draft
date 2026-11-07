import {join,resolve,relative} from 'node:path';
import {mkdir,cp,chmod,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {copySource} from '../desktop/files';
import {signBundledCode,macCommand,createMacInstaller} from './mac-distribution';

const root=resolve(import.meta.dir,'..'),version=(await Bun.file(join(root,'package.json')).json()).version;
const name=process.platform==='darwin'?(process.argv.includes('--public')?'Draft.app':'Draft Native.app'):'Draft-Native';
const stage=await mkdtemp(join(tmpdir(),'draft-native-package-'));
const app=join(stage,name),output=join(root,'native/rune-prototype/artifacts',name);
const bin=process.platform==='darwin'?join(app,'Contents/MacOS'):join(app,'bin');
const runtime=process.platform==='darwin'?join(app,'Contents/Resources/runtime'):join(app,'lib/draft');
const run=async(args:string[])=>{const child=Bun.spawn(args,{cwd:root,stdout:'inherit',stderr:'inherit'});if(await child.exited)throw Error(`Packaging failed: ${args[0]}`);};
if(!process.argv.includes('--skip-checks')){
  await run([process.execPath,'run','test']);await run([process.execPath,'run','test:host']);
  await run([process.execPath,'run','native:check']);
}
await run([process.execPath,'run','build']);
await run(['cargo','build','--manifest-path','native/rune-prototype/Cargo.toml','--locked','--release']);
await mkdir(bin,{recursive:true});await mkdir(runtime,{recursive:true});
await cp(join(root,'native/rune-prototype/target/release/draft'),join(bin,'draft'));
await cp(join(root,'native/rune-prototype/target/release/draft-rune-prototype'),join(bin,'draft-native'));
await cp(process.execPath,join(runtime,'bun'));
await copySource(root,join(runtime,'source-template'));
await cp(join(root,'dist'),join(runtime,'source-template/dist'),{recursive:true});
await cp(join(bin,'draft-native'),join(runtime,'source-template/dist/draft-native'));
await cp(join(root,'node_modules'),join(runtime,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true,filter:path=>{const name=relative(join(root,'node_modules'),path);return name!=='.bin/tauri'&&!name.startsWith('@tauri-apps')&&!name.startsWith('@anthropic-ai/claude-agent-sdk-')&&!name.startsWith('.cache');}});
const result=await Bun.build({entrypoints:[join(root,'native/rune-prototype/launcher.ts')],target:'bun',outdir:runtime,naming:'launcher.js',external:['@anthropic-ai/claude-agent-sdk']});
if(!result.success)throw Error(result.logs.join('\n'));
await run([process.execPath,'--bun',join(root,'node_modules/vite/bin/vite.js'),'build','--base','/host-ui/','--outDir',join(runtime,'host-ui'),'--emptyOutDir','--configLoader','native','--config',join(root,'vite.host.config.ts')]);
const bridge=await Bun.build({entrypoints:[join(root,'host-ui/bridge.ts')],outdir:join(runtime,'host-ui'),target:'browser'});if(!bridge.success)throw Error(bridge.logs.join('\n'));
if(process.platform==='darwin'){
  for(const [source,name] of [['MenuBar.swift','draft-menu'],['Spelling.swift','draft-spelling'],['InstallUpdate.swift','draft-install']])await run(['xcrun','swiftc','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos13.0`,join(root,'native',source),'-o',join(runtime,name)]);
  await cp(join(root,'src-tauri/icons/icon.icns'),join(app,'Contents/Resources/icon.icns'));
  await writeFile(join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>draft</string><key>CFBundleIdentifier</key><string>com.studiofour.draft.native</string><key>CFBundleIconFile</key><string>icon.icns</string><key>CFBundleName</key><string>Draft Native</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
  const identity=process.env.APPLE_SIGNING_IDENTITY??'-';await signBundledCode(app,identity);
  await macCommand(['/usr/bin/codesign','--force','--sign',identity,'--options','runtime',identity==='-'?'--timestamp=none':'--timestamp',app]);
  await macCommand(['/usr/bin/codesign','--verify','--deep','--strict',app]);
  if(process.argv.includes('--installer'))await createMacInstaller(app,join(root,`release/Draft-Native-${version}-${process.arch}.dmg`),identity);
}else{
  await chmod(join(bin,'draft'),0o755);await chmod(join(bin,'draft-native'),0o755);await chmod(join(runtime,'bun'),0o755);
  const icon=join(app,'share/icons/hicolor/512x512/apps');await mkdir(icon,{recursive:true});
  await cp(join(root,'src-tauri/icons/icon.png'),join(icon,'com.studiofour.draft.native.png'));
  const installer=await Bun.build({entrypoints:[join(root,'native/rune-prototype/install-desktop.ts')],target:'bun',outdir:runtime,naming:'install-desktop.js'});if(!installer.success)throw Error(installer.logs.join('\n'));
  await writeFile(join(app,'install-desktop'),'#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$app_dir/lib/draft/bun" "$app_dir/lib/draft/install-desktop.js" "$@"\n',{mode:0o755});
  await mkdir(join(root,'release'),{recursive:true});await run(['tar','-czf',join(root,`release/Draft-Native-${version}-linux-${process.arch}.tar.gz`),'-C',resolve(app,'..'),'Draft-Native']);
}
await mkdir(resolve(output,'..'),{recursive:true});
await rm(output,{recursive:true,force:true});await cp(app,output,{recursive:true,verbatimSymlinks:true});
await rm(stage,{recursive:true,force:true});
console.log(`Native app ready: ${output}`);
