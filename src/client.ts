import type {Draft} from './model';
declare global {interface Window {draftBoot:{library:{active:string;drafts:Draft[];archived?:Draft[]};version:string;error?:string};}}
type DemoTransport=(path:string,body?:unknown,signal?:AbortSignal)=>Promise<any>;
let demoTransport:DemoTransport|undefined,demoRestart:(()=>void)|undefined;
// Only the website's separate entry point installs this in-memory transport.
export function configureDemo(transport:DemoTransport,restart:()=>void){demoTransport=transport;demoRestart=restart;}
export function restartApp(){if(demoRestart)demoRestart();else window.location.reload();}
export async function api<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  if(demoTransport)return demoTransport(path,body,signal) as Promise<T>;
  const response=await fetch(path,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw Error(value.error??'Draft could not complete this request.');return value as T;
}
