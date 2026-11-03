import type {Draft} from './model';
import {safeLinkURL} from './markdown';
import {copyImageToClipboard,mediaURL} from './images';
export type Library={active:string;drafts:Draft[];archived:number;seq?:number};
// A draft that sync changed, added or took away while Draft was open.
export type LibraryChange={id:string;seq:number;draft?:Draft;gone?:'deleted'|'archived'};
declare global {interface Window {draftBoot:{library:Library;version:string;error?:string};}}
// The website walkthrough cancels this event to stand in for a restart without reloading the page.
export function restartApp(){if(window.dispatchEvent(new Event('draft:restart',{cancelable:true})))window.location.reload();}
export async function openLink(value:string){const url=safeLinkURL(value);if(!url)throw Error('Use a web address or mailto: link.');await api('/api/links/open',{url});}
// Image bytes are stored in the draft's media folder; the draft keeps a relative Markdown reference.
export async function uploadImage(draftId:string,image:Blob):Promise<{src:string}>{
  const response=await fetch(`/api/drafts/${encodeURIComponent(draftId)}/media`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':image.type},body:image});
  const value=await response.json();if(!response.ok)throw Error(value.error??'This image could not be added.');return value;
}
export async function copyImage(draftId:string,source:string|Blob|Promise<Blob>):Promise<void>{
  try{await copyImageToClipboard(typeof source==='string'?mediaURL(draftId,source):source);}
  catch{
    // The desktop host can always reach the macOS pasteboard for stored images.
    const src=typeof source==='string'?source:(await uploadImage(draftId,await source)).src;
    await api('/api/images/copy',{id:draftId,src});
  }
}
export async function api<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw Error(value.error??'Draft could not complete this request.');return value as T;
}
