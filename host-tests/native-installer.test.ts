import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';

async function run(args:string[]){const child=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'}),output=await new Response(child.stderr).text();assert.equal(await child.exited,0,output);}
test('the native installer replaces a verified app and restores the previous app when startup fails',{skip:process.platform!=='darwin',timeout:120000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-native-update-')),keys=generateKeyPairSync('ed25519');
 const helper=join(root,'installer'),childSource=join(root,'Child.swift'),childBinary=join(root,'child');
 try{
  await run(['xcrun','swiftc',join(import.meta.dir,'../native/InstallUpdate.swift'),'-o',helper]);
  await writeFile(childSource,`import Foundation\nimport Darwin\nlet root=ProcessInfo.processInfo.environment["DRAFT_DATA_ROOT"]!\nlet app=URL(fileURLWithPath:CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent()\nif FileManager.default.fileExists(atPath:app.appendingPathComponent("Resources/fail-startup").path){exit(17)}\nlet stateURL=URL(fileURLWithPath:root).appendingPathComponent("state.json")\nvar state=try! JSONSerialization.jsonObject(with:Data(contentsOf:stateURL)) as! [String:Any]\nif state["pendingActivation"] != nil {\nstate.removeValue(forKey:"pendingActivation");state.removeValue(forKey:"nativeInstallPlan")\nvar updates=state["updates"] as! [[String:Any]];updates[0]["state"]="applied";state["updates"]=updates\ntry! JSONSerialization.data(withJSONObject:state).write(to:stateURL,options:.atomic)\n}\ntry! JSONSerialization.data(withJSONObject:["hostPid":getpid(),"runtimePid":0]).write(to:URL(fileURLWithPath:root).appendingPathComponent("runtime-info.json"),options:.atomic)\nsleep(60)\n`);
  await run(['xcrun','swiftc',childSource,'-o',childBinary]);
  for(const scenario of ['success','failure','tampered']){
   const fails=scenario!=='success';
   const folder=join(root,scenario),app=join(folder,'Draft.app'),data=join(folder,'data'),id=crypto.randomUUID();
   for(const name of ['Contents/MacOS','Contents/Resources/runtime/source-template'])await mkdir(join(app,name),{recursive:true});await mkdir(join(data,'Documents'),{recursive:true});
   await cp(childBinary,join(app,'Contents/MacOS/fixture'));await cp(helper,join(app,'Contents/Resources/runtime/draft-install'));
   await writeFile(join(app,'Contents/Resources/runtime/source-template/update-public-key.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
   const info=(version:string)=>`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.eriknelson.draft.update-check</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>`;
   await writeFile(join(app,'Contents/Info.plist'),info('1.0.0'));await writeFile(join(app,'Contents/Resources/version.txt'),'old');
   await run(['/usr/bin/codesign','--force','--deep','--sign','-',app]);
   const incoming=join(folder,'release/Draft.app');await cp(app,incoming,{recursive:true});await writeFile(join(incoming,'Contents/Info.plist'),info('1.1.0'));await writeFile(join(incoming,'Contents/Resources/version.txt'),'new');if(scenario==='failure')await writeFile(join(incoming,'Contents/Resources/fail-startup'),'yes');await run(['/usr/bin/codesign','--force','--deep','--sign','-',incoming]);
   const archive=join(folder,'update.zip');await run(['/usr/bin/ditto','-c','-k','--keepParent',incoming,archive]);const bytes=await readFile(archive);
   const payload=JSON.stringify({schemaVersion:2,version:'1.1.0',nativeHostVersion:'1.1.0',desktop:{bundleId:'com.eriknelson.draft.update-check',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
   if(scenario==='tampered')await writeFile(archive,Buffer.concat([bytes,Buffer.from('changed after download')]));
   const parent=Bun.spawn(['/bin/sleep','0.2']),planPath=join(data,'NativeUpdates',id,'install-plan.json');await mkdir(join(data,'NativeUpdates',id),{recursive:true});
   const plan={schemaVersion:1,action:'install',appPath:app,dataRoot:data,updateId:id,target:'next',previous:'mine',previousOfficial:'original',targetHost:'1.1.0',previousHost:'1.0.0',bundleId:'com.eriknelson.draft.update-check',parentPid:parent.pid,runtimePid:0,archive,envelope:{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')}};
   await writeFile(planPath,JSON.stringify(plan));await writeFile(join(data,'Documents/writing.txt'),'My document is unchanged.');
   await writeFile(join(data,'state.json'),JSON.stringify({activeVersion:'next',officialVersion:'original',previousVersion:'mine',pendingActivation:{version:'next',previous:'mine'},updates:[{id,state:'applying'}]}));
   const installer=Bun.spawn([join(app,'Contents/Resources/runtime/draft-install'),planPath],{stdout:'pipe',stderr:'pipe'});const error=await new Response(installer.stderr).text();assert.equal(await installer.exited,0,error);
   assert.equal(await readFile(join(app,'Contents/Resources/version.txt'),'utf8'),fails?'old':'new');
   assert.equal(await readFile(join(data,'Documents/writing.txt'),'utf8'),'My document is unchanged.');
   const state=JSON.parse(await readFile(join(data,'state.json'),'utf8'));assert.equal(state.activeVersion,fails?'mine':'next');assert.equal(state.updates[0].state,fails?'failed':'applied');
   const runtime=JSON.parse(await readFile(join(data,'runtime-info.json'),'utf8').catch(()=>'{}'));if(runtime.hostPid)try{process.kill(runtime.hostPid,'SIGTERM');}catch{}
   if(!fails){
    const rollbackId=crypto.randomUUID(),rollbackPath=join(data,'NativeUpdates',rollbackId,'install-plan.json'),saved=JSON.parse(await readFile(join(data,'NativeUpdates/previous.json'),'utf8'));
    const oldParent=Bun.spawn(['/bin/sleep','0.2']);await mkdir(join(data,'NativeUpdates',rollbackId),{recursive:true});
    await writeFile(rollbackPath,JSON.stringify({...plan,action:'rollback',updateId:rollbackId,target:'mine',previous:'next',targetHost:'1.0.0',previousHost:'1.1.0',parentPid:oldParent.pid,backup:saved.path}));
    await writeFile(join(data,'state.json'),JSON.stringify({activeVersion:'mine',officialVersion:'original',pendingActivation:{version:'mine',previous:'next'},updates:[{id:rollbackId,state:'applying'}]}));
    const undo=Bun.spawn([join(app,'Contents/Resources/runtime/draft-install'),rollbackPath],{stdout:'pipe',stderr:'pipe'});assert.equal(await undo.exited,0,await new Response(undo.stderr).text());
    assert.equal(await readFile(join(app,'Contents/Resources/version.txt'),'utf8'),'old');assert.equal(await readFile(join(data,'Documents/writing.txt'),'utf8'),'My document is unchanged.');
    const back=JSON.parse(await readFile(join(data,'state.json'),'utf8'));assert.equal(back.activeVersion,'mine');assert.equal(back.updates[0].state,'applied');
    const child=JSON.parse(await readFile(join(data,'runtime-info.json'),'utf8'));try{process.kill(child.hostPid,'SIGTERM');}catch{}
   }
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
