import {mkdir,cp,rm,readFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {copySource,exists} from '../desktop/files';
import {build} from 'vite';
import {signBundledCode} from './mac-distribution';
const root=resolve(import.meta.dir,'..'),resources=join(root,'resources');
await rm(resources,{recursive:true,force:true});
await mkdir(resources,{recursive:true});
await build({root,base:'/host-ui/',build:{outDir:join(resources,'host-ui'),emptyOutDir:true,rollupOptions:{input:join(root,'host-ui/index.html')}}});
const bridge=await Bun.build({entrypoints:[join(root,'host-ui/bridge.ts')],outdir:join(resources,'host-ui'),target:'browser',minify:true});
if(!bridge.success)throw Error('The update controls could not be built.');
await copySource(root,join(resources,'source-template'));
await cp(join(root,'dist'),join(resources,'source-template/dist'),{recursive:true});
await cp(join(root,'desktop'),join(resources,'desktop'),{recursive:true});
await mkdir(join(resources,'src'),{recursive:true});await cp(join(root,'src/model.ts'),join(resources,'src/model.ts'));
await cp(join(root,'src/markdown.ts'),join(resources,'src/markdown.ts'));
await cp(process.execPath,join(resources,'bun'));
if(process.platform==='darwin'){
  const native=Bun.spawn(['xcrun','swiftc','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos13.0`,join(root,'native/Spelling.swift'),'-o',join(resources,'draft-spelling')],{stdout:'inherit',stderr:'inherit'});
  if(await native.exited)throw Error('The Mac spelling helper could not be built.');
  const installer=Bun.spawn(['xcrun','swiftc','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos13.0`,join(root,'native/InstallUpdate.swift'),'-o',join(resources,'draft-install')],{stdout:'inherit',stderr:'inherit'});
  if(await installer.exited)throw Error('The desktop update helper could not be built.');
}
await cp(join(root,'node_modules'),join(resources,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true,filter:path=>{
  const p=relative(join(root,'node_modules'),path);
  return p!=='.bin/tauri'&&!p.startsWith('@tauri-apps')&&!p.startsWith('@anthropic-ai/claude-agent-sdk-')&&!p.startsWith('.cache');
}});
if(process.platform==='darwin')await signBundledCode(resources,process.env.APPLE_SIGNING_IDENTITY??'-');
console.log('Desktop runtime, editable source, and build tools prepared.');
