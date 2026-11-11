import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite,exists,readJSON} from './files';
import type {Secrets,ZoConfig} from './zo-sync';

// A client ID metadata document on Draft's website (website/oauth). Zo shows its name on the
// consent page and accepts only the loopback callback it lists.
export const ZO_CLIENT_ID='https://draft.studiofour.io/oauth/client-metadata.json';
export type Workspace={workspace_id:string;name:string;subject:{type:string;id:string}};
export class SignInNeeded extends Error{}
type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;
type Token={token:string;expires:number};

// The desktop host owns the callback and all credentials. The renderer only sees status.
export class ZoAuth{
  private access?:Token;
  private refreshing?:Promise<string>;
  private callback?:ReturnType<typeof Bun.serve>;
  private timeout?:ReturnType<typeof setTimeout>;
  private generation=0;
  private abort?:AbortController;
  enabled=false;
  // A sign-in saved under an earlier client ID. It is revoked on the next sign-in, never refreshed.
  legacy=false;
  constructor(readonly root:string,private secrets:Secrets,private account:string,private config:ZoConfig,private fetch:Fetch){}
  private get path(){return join(this.root,'zo-auth.json');}
  private get resource(){return `${this.config.apiOrigin}/zo-system-api`;}
  private get key(){return `${this.account}-oauth`;}
  async initialize(){
    const saved=await exists(this.path)?(await readJSON<{clientId?:string}>(this.path).catch(()=>null))?.clientId:undefined;
    this.enabled=saved===ZO_CLIENT_ID;this.legacy=typeof saved==='string'&&!this.enabled;
  }
  invalidate(){this.access=undefined;}
  cancel(){this.generation++;this.abort?.abort();this.callback?.stop(true);this.callback=undefined;clearTimeout(this.timeout);}

  async begin(done:(error?:Error)=>Promise<void>):Promise<string>{
    this.cancel();const generation=this.generation;
    const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
    const controller=this.abort=new AbortController();let consumed=false;
    const finish=async(error?:Error)=>{if(generation!==this.generation)return;clearTimeout(this.timeout);await done(error);};
    const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
      const url=new URL(request.url);
      if(url.pathname!=='/callback'||request.method!=='GET')return new Response('Not found',{status:404});
      if(consumed||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state||url.searchParams.getAll('iss').length!==1||url.searchParams.get('iss')!==thisAuth.config.authOrigin)return new Response('Invalid sign-in response. Return to Draft and try again.',{status:400});
      consumed=true;
      try{
        if(url.searchParams.has('error'))throw Error('Zo sign-in was cancelled. You can try again.');
        const code=url.searchParams.get('code');if(!code||url.searchParams.getAll('code').length!==1)throw Error('Zo did not return a sign-in code.');
        const token=await thisAuth.exchange({grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:verifier},controller.signal);
        if(generation!==thisAuth.generation)throw Error('Sign-in cancelled.');
        await thisAuth.lock(async()=>{
          if(generation!==thisAuth.generation)return;
          await thisAuth.secrets.set(thisAuth.key,token.refresh_token);
          await atomicWrite(thisAuth.path,JSON.stringify({clientId:ZO_CLIENT_ID})+'\n');
          thisAuth.enabled=true;thisAuth.access={token:token.access_token,expires:Date.now()+token.expires_in*1000};
        });
        await finish();
        return new Response('Connected to Zo. You can close this tab and return to Draft.',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      }catch(error){await finish(error instanceof Error?error:Error('Draft could not sign in.'));return new Response('Sign-in did not finish. Return to Draft to try again.',{status:400});}
      finally{setTimeout(()=>{server.stop(true);if(thisAuth.callback===server)thisAuth.callback=undefined;},100);}
    }});
    const thisAuth=this,redirect=`http://127.0.0.1:${server.port}/callback`;
    this.callback=server;
    this.timeout=setTimeout(()=>{this.cancel();void done(Error('Zo sign-in timed out. Try again.'));},5*60_000);this.timeout.unref();
    const url=new URL('/zo-system-api/oauth/authorize',this.config.authOrigin);
    url.search=new URLSearchParams({response_type:'code',client_id:ZO_CLIENT_ID,redirect_uri:redirect,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state,resource:this.resource}).toString();
    return url.toString();
  }
  private async exchange(fields:Record<string,string>,signal?:AbortSignal){
    // Only bounded retries: Zo recovers a lost refresh response for 30 seconds.
    for(let attempt=0;;attempt++){
      let response:Response|undefined;
      try{response=await this.fetch(`${this.config.authOrigin}/zo-system-api/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:ZO_CLIENT_ID,resource:this.resource,...fields}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000)});}catch(error){if(signal?.aborted)throw error;}
      const body=await response?.json().catch(()=>null);
      if(response?.ok&&typeof body?.access_token==='string'&&typeof body?.refresh_token==='string'&&typeof body?.expires_in==='number'&&body.expires_in>0)return body as {access_token:string;refresh_token:string;expires_in:number};
      if(response&&[400,401].includes(response.status))throw new SignInNeeded('Your Zo sign-in ended. Connect to Zo again.');
      if(attempt>=1)throw Error('Zo is unavailable. Try connecting again in a moment.');
    }
  }
  async token():Promise<string>{
    if(this.access&&this.access.expires>Date.now()+30_000)return this.access.token;
    this.refreshing??=this.lock(async()=>{
      const saved=await readJSON<{clientId?:string;refreshUncertain?:boolean}>(this.path).catch(()=>null);
      if(saved&&saved.clientId!==ZO_CLIENT_ID)throw new SignInNeeded('Draft signs in to Zo a new way. Connect to Zo again.');
      if(saved?.refreshUncertain)throw new SignInNeeded('A Zo refresh was interrupted. Connect to Zo again.');
      const refresh=await this.secrets.get(this.key);if(!refresh)throw new SignInNeeded('Connect to Zo again.');
      // If this process stops after Zo rotates but before Keychain is updated, never replay
      // that token on a later launch outside Zo's bounded recovery window.
      await atomicWrite(this.path,JSON.stringify({clientId:ZO_CLIENT_ID,refreshUncertain:true})+'\n');
      const generation=this.generation,result=await this.exchange({grant_type:'refresh_token',refresh_token:refresh});
      if(generation!==this.generation)throw new SignInNeeded('Connection changed. Try again.');
      await this.secrets.set(this.key,result.refresh_token);
      await atomicWrite(this.path,JSON.stringify({clientId:ZO_CLIENT_ID})+'\n');
      this.access={token:result.access_token,expires:Date.now()+result.expires_in*1000};return result.access_token;
    }).finally(()=>{this.refreshing=undefined;});
    return this.refreshing;
  }
  async workspaces():Promise<Workspace[]>{
    const response=await this.fetch(`${this.config.apiOrigin}/zo-system-api/v1/session`,{headers:{Authorization:`Bearer ${await this.token()}`},signal:AbortSignal.timeout(15_000)});
    if(response.status===401)throw new SignInNeeded('Your Zo sign-in ended. Connect to Zo again.');
    if(!response.ok)throw Error('Draft could not read your Zo workspaces. Try again.');
    const result=await response.json();
    if(!Array.isArray(result.workspaces))throw Error('Zo did not return your workspaces.');
    return result.workspaces.filter((w:Workspace)=>typeof w.workspace_id==='string'&&typeof w.name==='string'&&typeof w.subject?.type==='string');
  }
  async disconnect(){
    this.cancel();this.enabled=false;this.access=undefined;
    await this.lock(async()=>{
      const refresh=await this.secrets.get(this.key);
      const clientId=(await readJSON<{clientId?:string}>(this.path).catch(()=>null))?.clientId??ZO_CLIENT_ID,legacy=clientId!==ZO_CLIENT_ID;
      if(refresh){
        // Retain the credential if revocation is unavailable, so disconnect can be retried. An
        // earlier client's sign-in is revoked once, best effort: it expires within 30 days anyway.
        const response=await this.fetch(`${this.config.authOrigin}/zo-system-api/oauth/revoke`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refresh,client_id:clientId,token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(15_000)}).catch(error=>{if(legacy)return null;throw error;});
        if(!response?.ok&&!legacy)throw Error('Zo could not revoke this sign-in. Try disconnecting again.');
      }
      await this.secrets.delete(this.key);await rm(this.path,{force:true});this.legacy=false;
    });
  }
  // Share refresh serialization with any second host using this data folder. Read the latest
  // Keychain value inside the lock. A crashed owner's lock can be reclaimed.
  private async lock<T>(run:()=>Promise<T>):Promise<T>{
    await mkdir(this.root,{recursive:true});const path=join(this.root,'zo-auth.lock');
    for(let attempt=0;;attempt++){
      try{await mkdir(path);await writeFile(join(path,'pid'),String(process.pid));break;}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        try{const pid=Number(await readFile(join(path,'pid'),'utf8'));try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){await rm(path,{recursive:true,force:true});continue;}}}
        catch{if(Date.now()-(await stat(path).catch(()=>({mtimeMs:Date.now()}))).mtimeMs>120_000){await rm(path,{recursive:true,force:true});continue;}}
        if(attempt>=200)throw Error('Another Draft process is signing in. Try again shortly.');
        await new Promise(r=>setTimeout(r,100));
      }
    }
    try{return await run();}finally{await rm(path,{recursive:true,force:true});}
  }
}
