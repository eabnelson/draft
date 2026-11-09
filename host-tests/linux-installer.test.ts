import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';

async function run(args:string[]){const child=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'}),output=await new Response(child.stderr).text();assert.equal(await child.exited,0,output);}
// Stands in for Draft: confirms a pending activation the way the real host does, then stays open.
const fixture=`const {readFileSync,writeFileSync,existsSync}=require('node:fs');const {join}=require('node:path');
const root=process.env.DRAFT_DATA_ROOT,runtime=join(__dirname);
if(existsSync(join(runtime,'fail-startup')))process.exit(17);
const statePath=join(root,'state.json'),state=JSON.parse(readFileSync(statePath,'utf8'));
if(state.pendingActivation){delete state.pendingActivation;delete state.nativeInstallPlan;state.updates[0].state='applied';writeFileSync(statePath,JSON.stringify(state));}
writeFileSync(join(root,'runtime-info.json'),JSON.stringify({hostPid:process.pid}));setTimeout(()=>{},30000);`;

test('the Linux installer replaces a verified app and restores the previous app when startup fails',{skip:process.platform!=='linux',timeout:120000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-linux-update-')),keys=generateKeyPairSync('ed25519'),bundleId='com.studiofour.draft.native.update-check';
 const helper=join(root,'install-update.js');
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'../native/rune-prototype/install-update.ts')],target:'bun',outdir:root,naming:'install-update.js',external:['bun:ffi']});assert.ok(built.success,built.logs.join('\n'));
 const stopHost=async(data:string)=>{const runtime=JSON.parse(await readFile(join(data,'runtime-info.json'),'utf8').catch(()=>'{}'));if(runtime.hostPid)try{process.kill(runtime.hostPid,'SIGTERM');}catch{}};
 try{
  for(const scenario of ['success','failure','tampered']){
   const fails=scenario!=='success';
   const folder=join(root,scenario),app=join(folder,'Draft'),data=join(folder,'data'),id=crypto.randomUUID(),runtime=join(app,'lib/draft');
   await mkdir(join(app,'bin'),{recursive:true});await mkdir(join(runtime,'source-template'),{recursive:true});await mkdir(join(data,'Documents'),{recursive:true});
   await symlink(process.execPath,join(runtime,'bun'));await cp(helper,join(runtime,'install-update.js'));await writeFile(join(runtime,'fixture.js'),fixture);
   await writeFile(join(runtime,'draft-install'),'#!/bin/sh\nset -eu\nruntime=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$runtime/bun" "$runtime/install-update.js" "$@"\n',{mode:0o755});
   await writeFile(join(app,'bin/draft'),'#!/bin/sh\napp=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$app/lib/draft/bun" "$app/lib/draft/fixture.js"\n',{mode:0o755});
   await writeFile(join(runtime,'source-template/update-public-key.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
   const info=(version:string)=>JSON.stringify({bundleId,version});
   await writeFile(join(runtime,'app.json'),info('1.0.0'));await writeFile(join(app,'version.txt'),'old');
   const incoming=join(folder,'release/Draft');await cp(app,incoming,{recursive:true,verbatimSymlinks:true});await writeFile(join(incoming,'lib/draft/app.json'),info('1.1.0'));await writeFile(join(incoming,'version.txt'),'new');
   if(scenario==='failure')await writeFile(join(incoming,'lib/draft/fail-startup'),'yes');
   const archive=join(folder,'update.tar.gz');await run(['tar','-czf',archive,'-C',join(folder,'release'),'Draft']);const bytes=await readFile(archive);
   const payload=JSON.stringify({schemaVersion:2,version:'1.1.0',nativeHostVersion:'1.1.0',linux:[{arch:process.arch,bundleId,desktop:{size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}]});
   if(scenario==='tampered')await writeFile(archive,Buffer.concat([bytes,Buffer.from('changed after download')]));
   const parent=Bun.spawn(['/bin/sleep','0.2']),planPath=join(data,'NativeUpdates',id,'install-plan.json');await mkdir(join(data,'NativeUpdates',id),{recursive:true});
   const plan={schemaVersion:1,action:'install',appPath:app,dataRoot:data,updateId:id,target:'next',previous:'mine',previousOfficial:'original',targetHost:'1.1.0',previousHost:'1.0.0',bundleId,parentPid:parent.pid,runtimePid:0,archive,envelope:{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')}};
   await writeFile(planPath,JSON.stringify(plan));await writeFile(join(data,'Documents/writing.txt'),'My document is unchanged.');
   await writeFile(join(data,'state.json'),JSON.stringify({activeVersion:'next',officialVersion:'original',previousVersion:'mine',pendingActivation:{version:'next',previous:'mine'},updates:[{id,state:'applying'}]}));
   const installer=Bun.spawn([join(runtime,'draft-install'),planPath],{stdout:'pipe',stderr:'pipe'});const error=await new Response(installer.stderr).text();assert.equal(await installer.exited,0,error);
   assert.equal(await readFile(join(app,'version.txt'),'utf8'),fails?'old':'new',scenario);
   assert.equal(await readFile(join(data,'Documents/writing.txt'),'utf8'),'My document is unchanged.');
   const state=JSON.parse(await readFile(join(data,'state.json'),'utf8'));assert.equal(state.activeVersion,fails?'mine':'next');assert.equal(state.updates[0].state,fails?'failed':'applied');
   const status=JSON.parse(await readFile(join(data,'NativeUpdates',id,'status.json'),'utf8'));assert.equal(status.phase,fails?'restored':'complete',status.detail);
   await stopHost(data);
   if(!fails){
    const saved=JSON.parse(await readFile(join(data,'NativeUpdates/previous.json'),'utf8'));
    assert.equal(saved.path,join(folder,`.Draft-previous-${id}`));assert.equal(await readFile(join(saved.path,'version.txt'),'utf8'),'old');
    const rollbackId=crypto.randomUUID(),rollbackPath=join(data,'NativeUpdates',rollbackId,'install-plan.json');
    const oldParent=Bun.spawn(['/bin/sleep','0.2']);await mkdir(join(data,'NativeUpdates',rollbackId),{recursive:true});
    await writeFile(rollbackPath,JSON.stringify({...plan,action:'rollback',updateId:rollbackId,target:'mine',previous:'next',targetHost:'1.0.0',previousHost:'1.1.0',parentPid:oldParent.pid,backup:saved.path}));
    await writeFile(join(data,'state.json'),JSON.stringify({activeVersion:'mine',officialVersion:'original',pendingActivation:{version:'mine',previous:'next'},updates:[{id:rollbackId,state:'applying'}]}));
    const undo=Bun.spawn([join(app,'lib/draft/draft-install'),rollbackPath],{stdout:'pipe',stderr:'pipe'});assert.equal(await undo.exited,0,await new Response(undo.stderr).text());
    assert.equal(await readFile(join(app,'version.txt'),'utf8'),'old');assert.equal(await readFile(join(data,'Documents/writing.txt'),'utf8'),'My document is unchanged.');
    const back=JSON.parse(await readFile(join(data,'state.json'),'utf8'));assert.equal(back.activeVersion,'mine');assert.equal(back.updates[0].state,'applied');
    await stopHost(data);
   }
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
