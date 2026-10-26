import {mkdir,cp,rm,readFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {copySource,exists} from '../desktop/files';
const root=resolve(import.meta.dir,'..'),resources=join(root,'resources');
await rm(resources,{recursive:true,force:true});
await mkdir(resources,{recursive:true});
await copySource(root,join(resources,'source-template'));
await cp(join(root,'dist'),join(resources,'source-template/dist'),{recursive:true});
await cp(join(root,'desktop'),join(resources,'desktop'),{recursive:true});
await mkdir(join(resources,'src'),{recursive:true});await cp(join(root,'src/model.ts'),join(resources,'src/model.ts'));
await cp(join(root,'src/markdown.ts'),join(resources,'src/markdown.ts'));
await cp(process.execPath,join(resources,'bun'));
await cp(join(root,'node_modules'),join(resources,'node_modules'),{recursive:true,dereference:false,filter:path=>{
  const p=relative(join(root,'node_modules'),path);
  return !p.startsWith('@tauri-apps')&&!p.startsWith('@anthropic-ai/claude-agent-sdk-')&&!p.startsWith('.cache');
}});
console.log('Desktop runtime, editable source, and build tools prepared.');
