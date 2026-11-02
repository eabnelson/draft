import {spawn} from 'node:child_process';
import {exists} from './files';

// WebKit may refuse image clipboard writes, so the host copies stored images directly.
export async function copyImageFile(image:{path:string;type:string}|null,run=osascript):Promise<void>{
  if(!image||!await exists(image.path))throw Error('This image is no longer available.');
  if(image.type==='image/webp'||image.type==='image/gif')throw Error('Copy this image from the image editor instead.');
  const kind=image.type==='image/png'?'«class PNGf»':'«class JPEG»';
  await run(['-e','on run argv','-e',`set the clipboard to (read (POSIX file (item 1 of argv)) as ${kind})`,'-e','end run',image.path]);
}

function osascript(args:string[]):Promise<void>{
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/osascript',args,{stdio:'ignore'});
    child.on('error',()=>reject(Error('This image could not be copied.')));
    child.on('exit',code=>code===0?resolve():reject(Error('This image could not be copied.')));
  });
}
