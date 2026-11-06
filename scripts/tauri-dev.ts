import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'..');
for(const args of [['run','build'],['build','src/runtime.ts','--target=bun','--outfile','dist/runtime.js'],['run','scripts/prepare-resources.ts']]){
  const child=Bun.spawn([process.execPath,...args],{cwd:root,stdout:'inherit',stderr:'inherit'});if(await child.exited)process.exit(1);
}
const child=Bun.spawn([process.execPath,'node_modules/@tauri-apps/cli/tauri.js','dev','--no-watch'],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,DRAFT_RUNTIME_ROOT:resolve(root,'resources')}});process.exit(await child.exited);
