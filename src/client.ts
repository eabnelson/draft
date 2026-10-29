import type {Draft} from './model';
import {safeLinkURL} from './markdown';
import {copyImageToClipboard} from './images';
declare global {interface Window {draftBoot:{library:{active:string;drafts:Draft[];archived?:Draft[]};version:string;error?:string};}}
type DemoTransport=(path:string,body?:unknown,signal?:AbortSignal)=>Promise<any>;
let demoTransport:DemoTransport|undefined,demoRestart:(()=>void)|undefined;
// Only the website's separate entry point installs this in-memory transport.
export function configureDemo(transport:DemoTransport,restart:()=>void){demoTransport=transport;demoRestart=restart;}
export function restartApp(){if(demoRestart)demoRestart();else window.location.reload();}
export async function openLink(value:string){const url=safeLinkURL(value);if(!url)throw Error('Use a web address or mailto: link.');if(demoTransport){window.open(url,'_blank','noopener,noreferrer');return;}await api('/api/links/open',{url});}
// Image bytes are stored beside the documents; the draft keeps a Markdown reference.
export async function uploadImage(image:Blob):Promise<{src:string}>{
  if(demoTransport)return {src:await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('This image could not be added.'));reader.readAsDataURL(image);})};
  const response=await fetch('/api/images',{method:'POST',credentials:'same-origin',headers:{'Content-Type':image.type},body:image});
  const value=await response.json();if(!response.ok)throw Error(value.error??'This image could not be added.');return value;
}
export async function copyImage(source:string|Blob|Promise<Blob>):Promise<void>{
  try{await copyImageToClipboard(source);}
  catch{
    // The desktop host can always reach the macOS pasteboard for stored images.
    if(demoTransport)throw Error('This image could not be copied.');
    const src=typeof source==='string'?source:(await uploadImage(await source)).src;
    if(!src.startsWith('/api/images/'))throw Error('This image could not be copied.');
    await api('/api/images/copy',{src});
  }
}
export async function api<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  if(demoTransport)return demoTransport(path,body,signal) as Promise<T>;
  const response=await fetch(path,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw Error(value.error??'Draft could not complete this request.');return value as T;
}
