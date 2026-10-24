import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'..');
for(const args of [['run','test'],['run','build'],['build','src/runtime.ts','--target=bun','--outfile','dist/runtime.js'],['run','scripts/prepare-resources.ts']]){
  const child=Bun.spawn([process.execPath,...args],{cwd:root,stdout:'inherit',stderr:'inherit'});if(await child.exited)process.exit(1);
}
const child=Bun.spawn([process.execPath,'node_modules/@tauri-apps/cli/tauri.js','build'],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,APPLE_SIGNING_IDENTITY:process.env.APPLE_SIGNING_IDENTITY??'-'}});process.exit(await child.exited);
