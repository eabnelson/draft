import {open,readdir,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';

export async function macCommand(args:string[]){
 const child=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
 if(await child.exited)throw Error(stderr.trim()||stdout.trim()||'The Mac distribution check failed.');
 return {stdout,stderr};
}
async function machFiles(root:string):Promise<string[]>{
 const paths:string[]=[];
 async function visit(folder:string){for(const entry of await readdir(folder,{withFileTypes:true})){
  const path=join(folder,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await visit(path);continue;}if(!entry.isFile())continue;
  const file=await open(path,'r'),bytes=Buffer.alloc(4);try{await file.read(bytes,0,4,0);}finally{await file.close();}
  if(['cffaedfe','cefaedfe','feedface','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(bytes.toString('hex')))paths.push(path);
 }}await visit(root);return paths.sort((a,b)=>b.split('/').length-a.split('/').length||a.localeCompare(b));
}
export async function signBundledCode(resources:string,identity:string){
 if(!identity)throw Error('Choose an Apple signing identity.');
 const paths=await machFiles(resources);
 for(const path of paths){
  const args=['/usr/bin/codesign','--force','--sign',identity,'--options','runtime',identity==='-'?'--timestamp=none':'--timestamp'];
  if(relative(resources,path)==='bun')args.push('--entitlements',resolve(import.meta.dir,'../native/Bun.entitlements.plist'));
  await macCommand([...args,path]);await macCommand(['/usr/bin/codesign','--verify','--strict',path]);
 }
 return paths;
}
export async function requireDeveloperIdCode(path:string,team:string){
 const {stderr}=await macCommand(['/usr/bin/codesign','-d','--verbose=4',path]);
 if(!stderr.includes('Authority=Developer ID Application:')||!stderr.includes(`TeamIdentifier=${team}\n`))throw Error('Public downloads require a Developer ID Application signature from the release team.');
 if(!/flags=.*\bruntime\b/.test(stderr)||!/^Timestamp=.+/m.test(stderr))throw Error('The signed executable needs hardened runtime and a secure timestamp.');
 await macCommand(['/usr/bin/codesign','--verify','--deep','--strict',path]);
 const entitlements=await macCommand(['/usr/bin/codesign','-d','--entitlements',':-',path]);
 if(/<key>com\.apple\.security\.get-task-allow<\/key>\s*<true\s*\/>/.test(entitlements.stdout))throw Error('A public download cannot include development debugging access.');
 return {team,developerId:true as const};
}
export async function verifyMacApp(app:string,team:string,notarized=true){
 await requireDeveloperIdCode(app,team);
 for(const path of await machFiles(join(app,'Contents/Resources/runtime')))await requireDeveloperIdCode(path,team);
 if(notarized){
  await macCommand(['xcrun','stapler','validate',app]);
  const assessment=await macCommand(['/usr/sbin/spctl','--assess','--type','execute','--verbose=2',app]);
  if(!/source=Notarized Developer ID/.test(assessment.stdout+assessment.stderr))throw Error('Gatekeeper did not confirm a notarized Developer ID application.');
  await macCommand(['/usr/bin/syspolicy_check','distribution',app]);
 }
 return {team,signed:true,notarized};
}
export async function createMacInstaller(app:string,path:string,identity?:string){
 await mkdir(dirname(path),{recursive:true});const stage=await mkdtemp(join(tmpdir(),'draft-installer-'));
 try{
  await macCommand(['/usr/bin/ditto',app,join(stage,'Draft.app')]);await symlink('/Applications',join(stage,'Applications'));
  await macCommand(['/usr/bin/hdiutil','create','-volname','Draft','-srcfolder',stage,'-format','UDZO','-ov',path]);
  if(identity&&identity!=='-')await macCommand(['/usr/bin/codesign','--force','--sign',identity,'--timestamp',path]);
 }finally{await rm(stage,{recursive:true,force:true});}
 return path;
}
