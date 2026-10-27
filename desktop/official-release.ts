import {createHash,verify} from 'node:crypto';
import {mkdir,open,rename,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {atomicWrite,within} from './files';

export type ReleaseArtifact={url:string;sha256:string;size:number};
export type ReleaseManifest={schemaVersion:2;version:string;publishedAt:string;notes:string[];nativeHostVersion:string;source:ReleaseArtifact;desktop:ReleaseArtifact&{bundleId:string;arch:'arm64'|'x64'}};
export type SignedRelease=ReleaseManifest&{envelope:{payload:string;signature:string};releaseUrl:string};
type ChannelOptions={feed?:string;publicKey:string;allowLocal?:boolean;bundleId?:string;arch?:string};
const defaultFeed='https://api.github.com/repos/eabnelson/draft/releases?per_page=20';

export class ReleaseChannel {
  constructor(readonly options:ChannelOptions){}
  private url(value:string){
    const url=new URL(value),local=this.options.allowLocal&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(url.username||url.password||(!local&&(url.hostname!=='github.com'||!url.pathname.startsWith('/eabnelson/draft/releases/download/'))))throw Error('The update address could not be verified.');
    if(!local&&url.protocol!=='https:'||local&&!['http:','https:'].includes(url.protocol))throw Error('The update needs a secure connection.');
    return url;
  }
  async latest(current:string):Promise<SignedRelease|undefined>{
    const response=await fetch(this.options.feed??defaultFeed,{headers:{Accept:'application/vnd.github+json','User-Agent':'Draft-Updater'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Draft couldn’t look for updates. Try again when you’re online.');
    const releases=await response.json() as any;if(!Array.isArray(releases))throw Error('The update list could not be read.');
    const preview=current.includes('-');
    const eligible=releases.filter(r=>{try{return !r.draft&&(preview||!r.prerelease)&&Bun.semver.order(String(r.tag_name).replace(/^v/,''),current)>0;}catch{return false;}}).sort((a,b)=>Bun.semver.order(String(b.tag_name).replace(/^v/,''),String(a.tag_name).replace(/^v/,'')));
    let unsupported=false;
    for(const release of eligible){
      const asset=release.assets?.find((asset:any)=>asset.name==='draft-update.json');if(!asset){unsupported=true;continue;}
      const manifestResponse=await fetch(this.url(asset.browser_download_url),{signal:AbortSignal.timeout(12000)});
      if(!manifestResponse.ok)throw Error('The update information couldn’t be downloaded.');
      const envelope=await manifestResponse.json() as {payload:string;signature:string};
      if(typeof envelope.payload!=='string'||envelope.payload.length>1_000_000||typeof envelope.signature!=='string'||!verify(null,Buffer.from(envelope.payload),this.options.publicKey,Buffer.from(envelope.signature,'base64')))throw Error('The update signature could not be verified. Your app is unchanged.');
      const value=JSON.parse(envelope.payload) as ReleaseManifest;
      if(value.schemaVersion!==2||value.version!==String(release.tag_name).replace(/^v/,'')||!Number.isFinite(Date.parse(value.publishedAt))||!Array.isArray(value.notes)||value.notes.length>12||value.notes.some(note=>typeof note!=='string'||note.length>300))throw Error('The update information is incomplete.');
      Bun.semver.order(value.nativeHostVersion,value.nativeHostVersion);
      for(const [artifact,limit] of [[value.source,15_000_000],[value.desktop,350_000_000]] as const){
        if(!artifact||!/^[a-f0-9]{64}$/.test(artifact.sha256)||!Number.isSafeInteger(artifact.size)||artifact.size<1||artifact.size>limit)throw Error('The update download could not be verified.');this.url(artifact.url);
      }
      if(value.desktop.bundleId!==(this.options.bundleId??'com.eriknelson.draft')||value.desktop.arch!==(this.options.arch??process.arch)){unsupported=true;continue;}
      return {...value,envelope,releaseUrl:String(release.html_url)};
    }
    if(unsupported)throw Error('A newer release is available, but its in-app update isn’t ready yet.');
  }
  async download(artifact:ReleaseArtifact,path:string,signal:AbortSignal,onProgress?:(received:number,total:number)=>void){
    const response=await fetch(this.url(artifact.url),{signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
    if(!response.ok||!response.body)throw Error('The update couldn’t be downloaded.');
    const declared=Number(response.headers.get('content-length'));if(declared&&declared!==artifact.size)throw Error('The update download has changed. Try checking again.');
    await mkdir(dirname(path),{recursive:true});const temporary=path+'.partial',file=await open(temporary,'w',0o600),hash=createHash('sha256');let received=0;
    try{for await(const chunk of response.body as any as AsyncIterable<Uint8Array>){received+=chunk.length;if(received>artifact.size)throw Error('The update download is larger than expected.');hash.update(chunk);await file.writeFile(chunk);onProgress?.(received,artifact.size);}await file.sync();}finally{await file.close();}
    if(received!==artifact.size||hash.digest('hex')!==artifact.sha256)throw Error('The update download could not be verified. Your app is unchanged.');
    await rename(temporary,path);return path;
  }
  async source(release:SignedRelease,destination:string,signal:AbortSignal){
    const archive=await this.download(release.source,destination+'.tar.gz',signal);
    const files=await new Bun.Archive(await readFile(archive)).files();let size=0;
    for(const [name,file] of files){const clean=name.replace(/^\.\//,''),path=join(destination,clean);if(clean.split('/').includes('..')||clean.startsWith('/')||clean.includes('\0')||!within(destination,path))throw Error('The update contains an invalid file.');size+=file.size;if(size>100_000_000)throw Error('The expanded update is too large.');await atomicWrite(path,new Uint8Array(await file.arrayBuffer()));}
    return destination;
  }
}
