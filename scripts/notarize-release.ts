import {mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileDigest} from '../desktop/native-update';
import {atomicWrite,exists} from '../desktop/files';
import {macCommand,verifyMacApp,createMacInstaller} from './mac-distribution';
const root=resolve(import.meta.dir,'..'),version=(await Bun.file(join(root,'package.json')).json()).version;
const team=process.env.APPLE_TEAM_ID,identity=process.env.APPLE_SIGNING_IDENTITY;
if(!team||!identity||identity==='-')throw Error('A public release requires the Apple distribution signing identity and team.');
const folder=join(root,'release/notarization');await mkdir(folder,{recursive:true});
const app=join(root,'src-tauri/target/release/bundle/macos/Draft.app');
const auth=process.env.APPLE_API_KEY_PATH&&process.env.APPLE_API_KEY?['--key',process.env.APPLE_API_KEY_PATH,'--key-id',process.env.APPLE_API_KEY,...(process.env.APPLE_API_ISSUER?['--issuer',process.env.APPLE_API_ISSUER]:[])]:['--keychain-profile',process.env.DRAFT_NOTARY_PROFILE??'draft-notary'];
async function notarize(path:string,label:string){
 const recordPath=join(folder,label+'.json'),sha256=await fileDigest(path);
 let record=await Bun.file(recordPath).json().catch(()=>undefined) as {id:string;sha256:string}|undefined;
 if(!record||record.sha256!==sha256){
  console.log(`Sending ${label} to Apple for notarization…`);
  const result=JSON.parse((await macCommand(['xcrun','notarytool','submit',path,...auth,'--no-wait','--output-format','json'])).stdout);
  if(typeof result.id!=='string')throw Error('Apple did not return a notarization submission.');
  record={id:result.id,sha256};await atomicWrite(recordPath,JSON.stringify(record,null,2));
 }
 const deadline=Date.now()+30*60*1000;
 while(Date.now()<deadline){
  const info=JSON.parse((await macCommand(['xcrun','notarytool','info',record.id,...auth,'--output-format','json'])).stdout);
  if(info.status==='Accepted'){console.log(`Apple approved ${label}.`);return;}
  if(info.status!=='In Progress'){
   const log=await macCommand(['xcrun','notarytool','log',record.id,...auth]);await atomicWrite(join(folder,label+'-log.json'),log.stdout);
   throw Error(`Apple did not approve ${label}. Read release/notarization/${label}-log.json before retrying.`);
  }
  console.log(`Apple is still checking ${label} (${record.id}).`);await new Promise(resolve=>setTimeout(resolve,15000));
 }
 throw Error(`Apple is still checking ${label}. Run this command again to resume submission ${record.id}.`);
}
async function staple(path:string){for(let attempt=0;attempt<6;attempt++){try{await macCommand(['xcrun','stapler','staple',path]);return;}catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,10000));}}}
await verifyMacApp(app,team,false);
try{await macCommand(['xcrun','stapler','validate',app]);console.log('The app already has its Apple approval ticket.');}
catch{
 const zip=join(folder,'app.zip');
 if(!await exists(zip))await macCommand(['/usr/bin/ditto','-c','-k','--keepParent',app,zip]);
 // Reuse a submission only for the same signed app, even after a fresh build.
 const signature=(await macCommand(['/usr/bin/codesign','-d','--verbose=4',app])).stderr.match(/^CDHash=(.+)$/m)?.[1];
 const signaturePath=join(folder,'app-signature.txt');
 if(await Bun.file(signaturePath).text().catch(()=>'')!==signature){await rm(zip,{force:true});await macCommand(['/usr/bin/ditto','-c','-k','--keepParent',app,zip]);await atomicWrite(signaturePath,signature??'');}
 await notarize(zip,'app');await staple(app);
}
await verifyMacApp(app,team);
const dmg=join(root,`src-tauri/target/release/bundle/dmg/Draft_${version}_${process.arch==='arm64'?'aarch64':'x64'}.dmg`);
await createMacInstaller(app,dmg,identity);await notarize(dmg,'installer');await staple(dmg);
await macCommand(['xcrun','stapler','validate',dmg]);
await macCommand(['/usr/sbin/spctl','--assess','--type','open','--context','context:primary-signature','--verbose=2',dmg]);
await atomicWrite(join(root,'release/distribution-report.json'),JSON.stringify({schemaVersion:1,version,team,developerId:true,notarized:true,appVerified:true,installerVerified:true},null,2)+'\n');
console.log('Signed, notarized app and installer passed Mac distribution checks.');
