import {mkdir,readFile,copyFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPublicKey,sign} from 'node:crypto';
import {fileDigest} from '../desktop/native-update';
import type {ReleaseManifest} from '../desktop/official-release';
const root=resolve(import.meta.dir,'..'),version=(await Bun.file(join(root,'package.json')).json()).version;
const output=join(root,'release'),tag=`v${version}`,base=`https://github.com/eabnelson/draft/releases/download/${tag}`;
const keyPath=process.env.DRAFT_UPDATE_SIGNING_KEY_PATH;if(!keyPath)throw Error('Set DRAFT_UPDATE_SIGNING_KEY_PATH to the private release key outside this repository.');
const key=await readFile(keyPath),publicKey=await readFile(join(root,'update-public-key.pem'));
if(!createPublicKey(key).export({type:'spki',format:'der'}).equals(createPublicKey(publicKey).export({type:'spki',format:'der'})))throw Error('The signing key does not match Draft’s installed update key.');
await mkdir(output,{recursive:true});
async function run(args:string[]){const child=Bun.spawn(args,{stdout:'ignore',stderr:'inherit'});if(await child.exited)throw Error('The release could not be packaged.');}
const source=join(output,`Draft-${version}-source.tar.gz`),desktop=join(output,`Draft-${version}-macos-${process.arch}.zip`);
const app=join(root,'src-tauri/target/release/bundle/macos/Draft.app');
for(const [key,expected] of [['CFBundleIdentifier','com.eriknelson.draft'],['CFBundleShortVersionString',version]]){
 const child=Bun.spawn(['/usr/libexec/PlistBuddy','-c',`Print :${key}`,join(app,'Contents/Info.plist')],{stdout:'pipe',stderr:'inherit'});
 if(await child.exited||(await new Response(child.stdout).text()).trim()!==expected)throw Error('The packaged app does not match this release.');
}
if((await Bun.file(join(root,'resources/source-template/features.json')).json()).appVersion!==version)throw Error('The bundled source does not match this release.');
await run(['/usr/bin/codesign','--verify','--deep','--strict',app]);
await run(['/usr/bin/tar','-czf',source,'-C',join(root,'resources/source-template'),'.']);
await run(['/usr/bin/ditto','-c','-k','--keepParent',app,desktop]);
const notes=await Bun.file(join(root,'release-notes.json')).json() as string[];
const artifact=async(path:string)=>({url:`${base}/${path.split('/').at(-1)}`,sha256:await fileDigest(path),size:(await stat(path)).size});
const manifest:ReleaseManifest={schemaVersion:2,version,publishedAt:new Date().toISOString(),notes,nativeHostVersion:version,source:await artifact(source),desktop:{...await artifact(desktop),bundleId:'com.eriknelson.draft',arch:process.arch as 'arm64'|'x64'}};
const payload=JSON.stringify(manifest),signature=sign(null,Buffer.from(payload),key).toString('base64');
await Bun.write(join(output,'draft-update.json'),JSON.stringify({payload,signature},null,2)+'\n');
const dmg=join(root,'src-tauri/target/release/bundle/dmg',`Draft_${version}_${process.arch==='arm64'?'aarch64':'x64'}.dmg`);
await copyFile(dmg,join(output,`Draft-${version}-macos-${process.arch}.dmg`));
const names=[source,desktop,join(output,`Draft-${version}-macos-${process.arch}.dmg`),join(output,'draft-update.json')];
await Bun.write(join(output,'SHA256SUMS'),(await Promise.all(names.map(async path=>`${await fileDigest(path)}  ${path.split('/').at(-1)}`))).join('\n')+'\n');
console.log(`Signed desktop and matching source prepared for ${tag}.`);
