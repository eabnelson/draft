import {resolve} from 'node:path';
import {createMacInstaller} from './mac-distribution';
const root=resolve(import.meta.dir,'..');
for(const args of [['run','test'],['run','test:host'],['run','build'],['build','src/runtime.ts','--target=bun','--outfile','dist/runtime.js'],['run','scripts/prepare-resources.ts']]){
  const child=Bun.spawn([process.execPath,...args],{cwd:root,stdout:'inherit',stderr:'inherit'});if(await child.exited)process.exit(1);
}
const child=Bun.spawn([process.execPath,'node_modules/@tauri-apps/cli/tauri.js','build','--bundles','app'],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,APPLE_SIGNING_IDENTITY:process.env.APPLE_SIGNING_IDENTITY??'-'}});
if(await child.exited)process.exit(1);
if(!process.argv.includes('--app-only')){
 const version=(await Bun.file(resolve(root,'package.json')).json()).version;
 await createMacInstaller(resolve(root,'src-tauri/target/release/bundle/macos/Draft.app'),resolve(root,`src-tauri/target/release/bundle/dmg/Draft_${version}_${process.arch==='arm64'?'aarch64':'x64'}.dmg`),process.env.APPLE_SIGNING_IDENTITY);
}
