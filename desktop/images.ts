import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {atomicWrite,exists} from './files';

const TYPES={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as const;
const CONTENT_TYPES={png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'} as const;
type Extension=keyof typeof CONTENT_TYPES;
export const MAX_IMAGE_BYTES=25*1024*1024;
const NAME=/^([a-f0-9]{32})\.(png|jpg|webp|gif)$/;

// Check the bytes, not only the declared type, before anything reaches the document folder.
function signature(bytes:Uint8Array):Extension|null {
  const starts=(...values:number[])=>values.every((v,i)=>bytes[i]===v);
  if(starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a))return 'png';
  if(starts(0xff,0xd8,0xff))return 'jpg';
  if(starts(0x47,0x49,0x46,0x38))return 'gif';
  if(starts(0x52,0x49,0x46,0x46)&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';
  return null;
}

export class ImageStore {
  constructor(readonly root:string){}
  async save(bytes:Uint8Array,declared:string):Promise<{src:string}>{
    const extension=TYPES[declared.split(';')[0].trim().toLowerCase() as keyof typeof TYPES];
    if(!extension)throw Error('Paste a PNG, JPEG, WebP or GIF image.');
    if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('Images must be smaller than 25 MB.');
    if(signature(bytes)!==extension)throw Error('This file is not a valid image.');
    // Identical images share one file; references stay valid if a draft is duplicated.
    const name=`${createHash('sha256').update(bytes).digest('hex').slice(0,32)}.${extension}`,path=join(this.root,name);
    if(!await exists(path))await atomicWrite(path,bytes);
    return {src:`/api/images/${name}`};
  }
  locate(src:string):{path:string;type:string}|null {
    const match=NAME.exec(src.replace(/^\/api\/images\//,''));
    if(!match||!src.startsWith('/api/images/'))return null;
    return {path:join(this.root,match[0]),type:CONTENT_TYPES[match[2] as Extension]};
  }
  async response(src:string):Promise<Response>{
    const image=this.locate(src);
    if(!image||!await exists(image.path))return new Response('Not found',{status:404});
    return new Response(Bun.file(image.path),{headers:{'Content-Type':image.type,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }
  // WebKit may refuse image clipboard writes, so the host copies stored images directly.
  async copy(src:string,run=osascript):Promise<void>{
    const image=this.locate(src);
    if(!image||!await exists(image.path))throw Error('This image is no longer available.');
    if(image.type==='image/webp'||image.type==='image/gif')throw Error('Copy this image from the image editor instead.');
    const kind=image.type==='image/png'?'«class PNGf»':'«class JPEG»';
    await run(['-e','on run argv','-e',`set the clipboard to (read (POSIX file (item 1 of argv)) as ${kind})`,'-e','end run',image.path]);
  }
}

function osascript(args:string[]):Promise<void>{
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/osascript',args,{stdio:'ignore'});
    child.on('error',()=>reject(Error('This image could not be copied.')));
    child.on('exit',code=>code===0?resolve():reject(Error('This image could not be copied.')));
  });
}
