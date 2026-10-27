import {mkdtemp,readFile,mkdir,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {Updates,type AgentConnection} from '../../desktop/updates';
import {atomicWrite,sourceHash,copySource} from '../../desktop/files';
import {sourceFiles} from '../../desktop/official-merge';
import {DocumentStore} from '../../desktop/documents';
import {fresh} from '../../src/model';
import type {Catalog,Version} from '../../desktop/types';

export async function officialFixture(options:{conflict?:boolean;agent?:AgentConnection['run'];noModel?:boolean}={}){
 const root=await mkdtemp(join(tmpdir(),'draft-official-flow-')),template=join(root,'template'),incoming=join(root,'release'),data=join(root,'data'),keys=generateKeyPairSync('ed25519');
 const catalog:Catalog={schemaVersion:1,name:'Draft',appVersion:'1.0.0',features:[{id:'writing',title:'Writing',description:'Write locally.',origin:'official',state:'active',updatedAt:'2026-10-24T00:00:00Z',code:['src/writing.ts']}]};
 const files:Record<string,string>={
  'features.json':JSON.stringify(catalog),'package.json':JSON.stringify({name:'draft-update-fixture',version:'1.0.0',type:'module'}),
  'tsconfig.json':JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',skipLibCheck:true,lib:['ESNext','DOM'],noEmit:true},include:['src']}),
  'vite.config.ts':'export default {base:"./",build:{target:"esnext"}};',
  'index.html':'<!doctype html><html><body><main id="app"></main><script type="module" src="./src/main.ts"></script></body></html>',
  'src/main.ts':'import {writing} from "./writing";\ndocument.querySelector("#app")!.textContent=writing;\n// custom features\n',
  'src/writing.ts':'export const writing = "Original writing";\n','src/runtime.ts':'export async function handleRequest(){return null;}',
  'tests/writing.test.ts':'import {test,expect} from "bun:test";import {writing} from "../src/writing";test("writing works",()=>expect(writing.length).toBeGreaterThan(0));',
  'dist/index.html':'<main>Original writing</main>','docs/feature-builder.md':'Preserve the writer’s features.',
  'update-public-key.pem':keys.publicKey.export({type:'spki',format:'pem'}).toString(),
 };
 for(const folder of ['desktop','scripts','src-tauri','native'])files[folder+'/controller.txt']='official controller';
 for(const [name,value] of Object.entries(files))await atomicWrite(join(template,name),value);
 await copySource(template,incoming);await mkdir(join(incoming,'dist'));await atomicWrite(join(incoming,'dist/index.html'),'<main>Official update</main>');
 const next={...catalog,appVersion:'1.1.0',features:[{...catalog.features[0],description:'Write with spelling help.',updatedAt:'2026-10-27T00:00:00Z'},{id:'spelling',title:'Spelling',description:'Check words as you write.',origin:'official' as const,state:'active' as const,updatedAt:'2026-10-27T00:00:00Z',code:['src/writing.ts']}]};
 await atomicWrite(join(incoming,'features.json'),JSON.stringify(next));await atomicWrite(join(incoming,'src/writing.ts'),'export const writing = "Spelling enabled";\n');
 if(options.conflict)await atomicWrite(join(incoming,'src/main.ts'),'import {writing} from "./writing";\ndocument.querySelector("#app")!.textContent=writing;\ndocument.body.dataset.appearance="light";\n');
 const all=await sourceFiles(incoming),archiveFiles:Record<string,Uint8Array>={};for(const [name,bytes] of all)archiveFiles[name]=bytes;archiveFiles['dist/index.html']=new TextEncoder().encode('<main>Official update</main>');
 const archive=await new Bun.Archive(archiveFiles).bytes(),digest=createHash('sha256').update(archive).digest('hex');
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){const origin=new URL(request.url).origin,path=new URL(request.url).pathname;
  if(path==='/source')return new Response(archive);
  if(path==='/manifest'){const payload=JSON.stringify({schemaVersion:2,version:'1.1.0',publishedAt:'2026-10-27T16:00:00Z',notes:['Spelling help is now included.'],nativeHostVersion:'1.1.0',source:{url:origin+'/source',size:archive.length,sha256:digest},desktop:{url:origin+'/desktop.zip',size:1,sha256:'b'.repeat(64),arch:process.arch,bundleId:'com.eriknelson.draft'}});return Response.json({payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')});}
  return Response.json([{tag_name:'v1.1.0',draft:false,prerelease:false,html_url:'https://github.com/eabnelson/draft/releases/tag/v1.1.0',assets:[{name:'draft-update.json',browser_download_url:origin+'/manifest'}]}]);
 }});
 const agents:AgentConnection={discover:async()=>[],login:async()=>[],select:async()=>options.noModel?undefined:{provider:'claude',model:'fixture'},run:options.agent??(async()=>{throw Error('The independent merge should not need a model.');})};
 const dependencies=resolve(import.meta.dir,'../../node_modules');
 const host=new Updates(data,template,dependencies,process.execPath,{feed:`http://127.0.0.1:${server.port}/releases`,allowLocal:true,builds:join(root,'builds'),hostVersion:'1.1.0',agents});await host.initialize();
 const customSource=join(root,'personal/source'),customDist=join(root,'personal/dist');await copySource(host.active.source,customSource);await cp(host.active.dist,customDist,{recursive:true});
 const personal={...structuredClone(catalog),features:[...catalog.features,{id:'appearance',title:'My theme',description:'Keep my dark appearance.',origin:'personal' as const,state:'active' as const,updatedAt:'2026-10-26T00:00:00Z',code:['src/main.ts','src/appearance.ts','tests/appearance.test.ts']},{id:'reading',title:'Reading time',description:'Show reading time.',origin:'personal' as const,state:'active' as const,updatedAt:'2026-10-26T00:00:00Z',code:['src/reading.ts','tests/reading.test.ts']}]};
 await atomicWrite(join(customSource,'features.json'),JSON.stringify(personal));await atomicWrite(join(customSource,'src/appearance.ts'),'export const appearance = "dark";');await atomicWrite(join(customSource,'src/reading.ts'),'export const minutes = 3;');
 await atomicWrite(join(customSource,'src/main.ts'),'import {writing} from "./writing";\ndocument.querySelector("#app")!.textContent=writing;\nimport {appearance} from "./appearance";document.body.dataset.appearance=appearance;\n');
 for(const [name,text] of [['appearance','import {appearance} from "../src/appearance";test("personal dark appearance remains",()=>expect(appearance).toBe("dark"));'],['reading','import {minutes} from "../src/reading";test("personal reading time remains",()=>expect(minutes).toBe(3));']])await atomicWrite(join(customSource,`tests/${name}.test.ts`),'import {test,expect} from "bun:test";'+text);
 const version:Version={...host.active,id:'personal-start',source:customSource,dist:customDist,catalog:personal,sourceHash:await sourceHash(customSource),artifactHash:await sourceHash(customDist),parentId:host.active.id,hostVersion:'1.1.0'};host.state.versions.push(version);host.state.activeVersion=version.id;
 const docs=new DocumentStore(join(data,'Documents'));const draft={...fresh(),text:'My writing stays on this Mac.'};await docs.save({active:draft.id,drafts:[draft]});
 return {root,host,docs,template,incoming,data,server,async close(){host.stopAutomaticChecks();server.stop(true);await rm(root,{recursive:true,force:true});}};
}

export async function settled(host:Updates,id:string){
 for(let i=0;i<400;i++){const update=host.view().updates.find(update=>update.id===id)!;if(['ready','needs-attention','failed','cancelled','applied'].includes(update.state))return update;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('The update did not finish preparing.');
}
