import type {Draft} from './model';
declare global {interface Window {draftBoot:{library:{active:string;drafts:Draft[];archived?:Draft[]};version:string;error?:string};}}
export async function api<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw Error(value.error??'Draft could not complete this request.');return value as T;
}
