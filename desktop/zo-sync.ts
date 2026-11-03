// Saves a copy of every draft to a folder in a Zo workspace.
//
// Draft connects the way any outside app does: with a service account the person creates in their
// workspace, so setting it up needs nothing from Zo itself. The drafts on this Mac stay the source
// of truth. Sync only reads them and copies them up: it never writes a draft, so nothing you are
// editing can change under you, and saving never waits on the network. A failed upload is retried
// later; Zo keeps every earlier version of each file, so replacing one loses nothing.
import {basename,dirname,join} from 'node:path';
import {readdir,readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {atomicWrite,exists,readJSON} from './files';

export type ZoConfig={authOrigin:string;apiOrigin:string};
export const ZO:ZoConfig={
  authOrigin:process.env.DRAFT_ZO_AUTH_ORIGIN??'https://auth.zo.computer',
  apiOrigin:process.env.DRAFT_ZO_API_ORIGIN??'https://api.zo.computer',
};
export const DEFAULT_FOLDER='/workspace/Draft';
const CLAIMS='https://zo.computer/claims/system-api';
// Wait for a pause in typing so every keystroke is not a new version in Zo, but never hold
// changes back for long.
export const QUIET_MS=15_000,MAX_WAIT_MS=120_000,SWEEP_MS=10*60_000;
const INLINE_BYTES=512*1024;
const TRANSIENT=new Set(['implementation_unavailable','temporarily_unavailable','unavailable','rate_limited','internal_error','timeout']);
const MEDIA_NAME=/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/,VERSION_NAME=/^v\d+\.md$/;

export interface Secrets{get(account:string):Promise<string|null>;set(account:string,value:string):Promise<void>;delete(account:string):Promise<void>}
// The service account's secret lives in the login Keychain. It goes to `security` on stdin, never
// as an argument, so it does not appear in the process list.
export class Keychain implements Secrets{
  constructor(readonly service='Draft Zo sync'){}
  private run(args:string[],input?:string){
    return new Promise<{code:number;out:string}>(resolve=>{
      const child=spawn('/usr/bin/security',args,{stdio:['pipe','pipe','ignore']});let out='';
      child.stdout.on('data',chunk=>out+=chunk);child.once('error',()=>resolve({code:1,out:''}));child.once('exit',code=>resolve({code:code??1,out}));
      child.stdin.end(input??'');
    });
  }
  async get(account:string){const r=await this.run(['find-generic-password','-s',this.service,'-a',account,'-w']);return r.code===0?r.out.replace(/\n$/,''):null;}
  async set(account:string,value:string){
    if(!/^[\w.~+/=-]+$/.test(value)||!/^[\w.-]+$/.test(account))throw Error('That secret has characters Draft can’t store.');
    const r=await this.run(['-i'],`add-generic-password -U -s "${this.service}" -a "${account}" -w "${value}"\n`);
    if(r.code!==0||await this.get(account)!==value)throw Error('Draft couldn’t save the secret to your Keychain.');
  }
  async delete(account:string){await this.run(['delete-generic-password','-s',this.service,'-a',account]);}
}

export class ZoError extends Error{constructor(readonly code:string,message:string,readonly transient=false){super(message);}}
class NeedsCredentials extends Error{}

type FileState={id:string;revision:number;sha:string;size:number;mtime:number};
// No folder yet means connected, waiting for the person to choose where drafts go.
type State={schemaVersion:2;clientId:string;workspaceId:string;workspaceName?:string;base?:string;files:Record<string,FileState>;lastSyncedAt?:string;connectedAt:string};
export type SyncStatus={
  state:'off'|'choose-folder'|'waiting'|'syncing'|'synced'|'needs-credentials'|'error';
  workspace?:string;folder?:string;lastSyncedAt?:string;pending?:number;message?:string;
};
type LocalFile={rel:string;path:string;size:number;mtime:number};
type RemoteFile={id:string;revision:number};
export type FolderList={path:string|null;parent:string|null;folders:{name:string;path:string}[]};
type Fetch=(input:string,init?:RequestInit)=>Promise<Response>;
type Options={secrets?:Secrets;config?:ZoConfig;fetch?:Fetch;sleep?:(ms:number)=>Promise<void>;timers?:boolean};

const sha256=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function workspaceOf(accessToken:string):string{
  try{const claims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString('utf8'));const id=claims?.[CLAIMS]?.workspace_id;if(typeof id==='string'&&id)return id;}catch{}
  throw Error('Zo didn’t say which workspace this service account belongs to.');
}
// The .env file Zo downloads for a new credential, or its two values pasted in any order. The block
// from Draft's setup prompt also names the workspace and the folder the agent made for Draft.
export function parseCredentials(text:string):{clientId:string;clientSecret:string;workspaceName?:string;folder?:string}{
  const value=(name:string)=>new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\s]+)["']?\\s*$`,'m').exec(text)?.[1];
  const phrase=(name:string)=>new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=[ \\t]*(.*?)[ \\t]*$`,'m').exec(text)?.[1]?.replace(/^(["'])(.*)\1$/,'$2').trim()||undefined;
  const clientId=value('ZO_SYSTEM_API_CLIENT_ID'),clientSecret=value('ZO_SYSTEM_API_CLIENT_SECRET');
  if(!clientId||!clientSecret)throw Error('Paste the block your agent gave you, or the .env file from Zo. It has ZO_SYSTEM_API_CLIENT_ID and ZO_SYSTEM_API_CLIENT_SECRET.');
  const workspaceName=phrase('ZO_WORKSPACE_NAME')?.slice(0,200),folder=phrase('DRAFT_ZO_FOLDER');
  return {clientId,clientSecret,...workspaceName?{workspaceName}:{},...folder?{folder}:{}};
}
export function normalizeFolder(value:unknown):string{
  const folder=(typeof value==='string'&&value.trim()?value.trim():DEFAULT_FOLDER).replace(/\/+$/,'');
  if(!folder.startsWith('/')||folder.length>1000||folder.split('/').slice(1).some(part=>!part||part==='.'||part==='..')||/[\u0000-\u001f]/.test(folder))throw Error('Use a folder path in Zo such as /workspace/Draft.');
  return folder;
}

export class ZoSync{
  private state:State|null=null;
  private access?:{token:string;expires:number};private exchanging?:Promise<string>;
  private phase:SyncStatus['state']='off';private message?:string;private pending=0;
  private firstChange=0;private lastChange=0;private timer?:ReturnType<typeof setTimeout>;private sweep?:ReturnType<typeof setInterval>;
  private running?:Promise<void>;private again=false;
  private readonly secrets:Secrets;private readonly config:ZoConfig;private readonly fetch:Fetch;private readonly sleep:(ms:number)=>Promise<void>;private readonly timers:boolean;
  constructor(readonly dataRoot:string,readonly draftsRoot:string,options:Options={}){
    this.secrets=options.secrets??new Keychain();this.config=options.config??ZO;
    this.fetch=options.fetch??((input,init)=>globalThis.fetch(input,init));this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));this.timers=options.timers??true;
  }
  private get statePath(){return join(this.dataRoot,'zo-sync.json');}
  // One Keychain item per data folder, so a test or development copy of Draft never uses the real app's credential.
  private get account(){return `client-${sha256(this.dataRoot).slice(0,16)}`;}
  private get resource(){return `${this.config.apiOrigin}/zo-system-api`;}
  private get stopped(){return this.phase==='needs-credentials';}

  async initialize(){
    try{if(await exists(this.statePath)){const value=await readJSON<State>(this.statePath);if(value?.schemaVersion===2&&typeof value.clientId==='string'&&typeof value.workspaceId==='string')this.state={...value,files:value.files??{}};}}catch{}
    if(!this.state)return;
    if(!this.state.base){this.phase='choose-folder';return;}
    this.phase='waiting';this.startSweep();this.schedule(0);
  }
  status():SyncStatus{
    const s=this.state;
    return {state:s?this.phase:'off',workspace:s?.workspaceName,folder:s?.base,lastSyncedAt:s?.lastSyncedAt,pending:this.pending||undefined,message:this.message};
  }
  // Called after any save. It only notes the change; the upload happens later, off the save path.
  changed(){
    if(!this.state?.base||this.stopped)return;
    const now=Date.now();this.lastChange=now;if(!this.firstChange)this.firstChange=now;
    if(this.phase==='synced')this.phase='waiting';
    if(!this.timer)this.schedule(QUIET_MS);
  }
  syncNow(){if(!this.state)throw Error('Connect a Zo workspace first.');if(!this.state.base)throw Error('Choose a folder in Zo first.');if(this.stopped)throw Error('Connect again with a new credential first.');this.firstChange=this.firstChange||Date.now();this.schedule(0);return this.status();}
  private schedule(ms:number){
    if(!this.timers)return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;
      const now=Date.now(),quiet=now-this.lastChange>=QUIET_MS,overdue=this.firstChange&&now-this.firstChange>=MAX_WAIT_MS;
      if(ms>0&&!quiet&&!overdue){this.schedule(Math.min(QUIET_MS-(now-this.lastChange),MAX_WAIT_MS-(now-this.firstChange)));return;}
      void this.run();
    },ms);
    (this.timer as any)?.unref?.();
  }
  private startSweep(){if(!this.timers||this.sweep)return;this.sweep=setInterval(()=>{if(this.state&&!this.stopped)void this.run();},SWEEP_MS);(this.sweep as any).unref?.();}

  // One pass at a time; a change during a pass runs another one after it.
  run():Promise<void>{
    if(this.running){this.again=true;return this.running;}
    this.running=(async()=>{
      do{this.again=false;this.firstChange=0;await this.pass();}while(this.again&&this.state&&!this.stopped);
    })().finally(()=>{this.running=undefined;});
    return this.running;
  }
  private async pass(){
    const state=this.state;if(!state?.base)return;
    this.phase='syncing';this.message=undefined;
    try{
      const files=await this.localFiles(),changed:{file:LocalFile;bytes:Buffer;sha:string}[]=[];
      for(const file of files){
        const known=state.files[file.rel];
        if(known&&known.size===file.size&&known.mtime===file.mtime)continue;
        let bytes:Buffer;try{bytes=await readFile(file.path);}catch{continue;}
        const sha=sha256(bytes);
        if(known?.sha===sha){state.files[file.rel]={...known,size:file.size,mtime:file.mtime};continue;}
        changed.push({file,bytes,sha});
      }
      const index=Buffer.from(await this.index(files)),indexSha=sha256(index);
      if(state.files['Drafts.md']?.sha!==indexSha)changed.push({file:{rel:'Drafts.md',path:'',size:index.length,mtime:0},bytes:index,sha:indexSha});
      this.pending=changed.length;
      for(const item of changed){
        if(this.state!==state)return;
        const remote=await this.upload(state,item.file.rel,item.bytes,item.sha);
        state.files[item.file.rel]={...remote,sha:item.sha,size:item.file.size,mtime:item.file.mtime};
        this.pending--;await this.save();
      }
      state.lastSyncedAt=new Date().toISOString();await this.save();
      this.phase=this.firstChange?'waiting':'synced';
    }catch(error){
      if(this.state!==state)return;
      if(error instanceof NeedsCredentials){this.phase='needs-credentials';this.message='Zo no longer accepts this service account. Connect again with a new credential.';return;}
      this.phase='error';
      const code=error instanceof ZoError?error.code:'';
      // Zo answers the same way whether a folder is missing or out of reach.
      this.message=code==='quota_exceeded'?`${state.workspaceName??'Your workspace'} is out of storage. Your drafts are safe on this Mac.`
        :code==='permission_denied'||code==='resource_not_found'?`This service account can’t save to ${state.base}. In Zo, let it edit that folder or give it Full access, then choose Save now.`
        :'Draft couldn’t reach Zo. It will try again soon. Your drafts are safe on this Mac.';
      // Missing access needs a person; anything else is tried again in a minute.
      if(this.timers&&code!=='permission_denied'&&code!=='resource_not_found'){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.run();},60_000);(this.timer as any).unref?.();}
    }finally{this.pending=0;}
  }

  // Every draft package: its record, each version as Markdown, and its images. Undo history stays on this Mac.
  private async localFiles():Promise<LocalFile[]>{
    const files:LocalFile[]=[];
    if(!await exists(this.draftsRoot))return files;
    for(const entry of await readdir(this.draftsRoot,{withFileTypes:true})){
      if(!entry.isDirectory()||!entry.name.endsWith('.draft'))continue;
      const root=join(this.draftsRoot,entry.name);if(!await exists(join(root,'draft.json')))continue;
      const names=['draft.json'];
      for(const [folder,pattern] of [['versions',VERSION_NAME],['media',MEDIA_NAME]] as const){
        try{for(const name of await readdir(join(root,folder)))if(pattern.test(name))names.push(`${folder}/${name}`);}catch{}
      }
      for(const name of names){try{const info=await stat(join(root,name));if(info.isFile())files.push({rel:`${entry.name}/${name}`,path:join(root,name),size:info.size,mtime:info.mtimeMs});}catch{}}
    }
    return files.sort((a,b)=>a.rel.localeCompare(b.rel));
  }
  // A readable list at the top of the folder, so a person or agent in Zo can find a draft by title.
  private async index(files:LocalFile[]){
    const rows:string[]=[];
    for(const file of files.filter(f=>f.rel.endsWith('/draft.json'))){
      let title='';try{title=String((await readJSON<{title?:unknown}>(file.path)).title??'').trim();}catch{}
      rows.push(`- ${(title||'Untitled').replace(/[\r\n]+/g,' ')} — \`${dirname(file.rel)}\``);
    }
    rows.sort((a,b)=>a.localeCompare(b));
    return `# Drafts\n\nSaved from Draft on your Mac. Each folder is one draft: \`draft.json\`, and every version as Markdown in \`versions/\`.\n\n${rows.join('\n')}\n`;
  }
  private async upload(state:State,rel:string,bytes:Buffer,sha:string):Promise<RemoteFile>{
    const path=`${state.base}/${rel}`,known=state.files[rel],key=(step:string,revision=0)=>`draft-${step}-${sha256(`${state.workspaceId}:${state.base}/${rel}:${sha}:${revision}`).slice(0,48)}`;
    const text=!rel.includes('/media/')&&bytes.length<=INLINE_BYTES?bytes.toString('utf8'):null;
    const replace=async(file:RemoteFile):Promise<RemoteFile>=>{
      try{return await this.replace(file,bytes,text,key('update',file.revision));}
      catch(error){
        // Changed in Zo since Draft last saved it: Zo keeps that version in the file's history.
        if(error instanceof ZoError&&error.code==='conflict'){const now=await this.invoke<RemoteFile>('zo.file.get_metadata',{file_id:file.id});return this.replace(now,bytes,text,key('update',now.revision));}
        throw error;
      }
    };
    if(known){
      try{return await replace(known);}
      catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;}
    }
    for(let attempt=0;;attempt++){
      try{return await this.create(dirname(path),basename(path),bytes,text,key('create'));}
      catch(error){
        if(!(error instanceof ZoError&&error.code==='conflict'))throw error;
        // Already there, from an earlier connection: take it over.
        try{return await replace(await this.invoke<RemoteFile>('zo.file.get_metadata',{path}));}
        catch(missing){
          // Not there after all: making its folders raced with something else in Zo. The same request is safe to repeat.
          if(!(missing instanceof ZoError&&missing.code==='resource_not_found')||attempt>=2)throw missing;
          await this.sleep(1000*(attempt+1));
        }
      }
    }
  }
  private async create(parent:string,name:string,bytes:Buffer,text:string|null,key:string):Promise<RemoteFile>{
    if(text!==null)return this.invoke<RemoteFile>('zo.file.create',{parent_path:parent,create_parent_folders:true,name,content:text,idempotency_key:key});
    const prepared=await this.invoke<{upload_id:string;upload_url:string;upload_headers?:Record<string,string>}>('zo.file.prepare_create',{parent_path:parent,create_parent_folders:true,name,byte_length:bytes.length,idempotency_key:`${key}-prepare`});
    await this.put(prepared,bytes);
    return this.invoke<RemoteFile>('zo.file.create',{upload_id:prepared.upload_id,idempotency_key:key});
  }
  private async replace(file:RemoteFile,bytes:Buffer,text:string|null,key:string):Promise<RemoteFile>{
    if(text!==null)return this.invoke<RemoteFile>('zo.file.update',{file_id:file.id,content:text,expected_revision:file.revision,idempotency_key:key});
    const prepared=await this.invoke<{upload_id:string;upload_url:string;upload_headers?:Record<string,string>}>('zo.file.prepare_update',{file_id:file.id,byte_length:bytes.length,expected_revision:file.revision,idempotency_key:`${key}-prepare`});
    await this.put(prepared,bytes);
    return this.invoke<RemoteFile>('zo.file.update',{file_id:file.id,upload_id:prepared.upload_id,expected_revision:file.revision,idempotency_key:key});
  }
  private async put(prepared:{upload_url:string;upload_headers?:Record<string,string>},bytes:Buffer){
    for(let attempt=0;;attempt++){
      let response:Response|undefined;
      try{response=await this.fetch(prepared.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',...prepared.upload_headers},body:new Uint8Array(bytes),signal:AbortSignal.timeout(120_000)});}catch{}
      if(response?.ok)return;
      if(attempt>=3)throw new ZoError('upload_failed','The upload to Zo didn’t finish.',true);
      await this.sleep(1000*2**attempt);
    }
  }

  // System API call as the service account. Transient failures retry with the same idempotency
  // key, so a write that may already have happened is never done twice.
  async invoke<T>(action:string,input:Record<string,unknown>,version=1,query?:Record<string,unknown>):Promise<T>{
    let renewed=false;
    for(let attempt=0;;attempt++){
      const token=await this.token();
      let response:Response|undefined;
      try{response=await this.fetch(`${this.config.apiOrigin}/zo-system-api/v1/invoke`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,input,options:query?{version,query}:{version}}),signal:AbortSignal.timeout(90_000)});}catch{}
      if(response?.status===401&&!renewed){renewed=true;this.access=undefined;attempt--;continue;}
      const body=response?await response.json().catch(()=>null) as any:null;
      if(response?.ok&&body&&'result' in body)return body.result as T;
      const code=String(body?.error?.code??(response?`http_${response.status}`:'network')),transient=!response||response.status>=500||response.status===429||TRANSIENT.has(code);
      if(response?.status===401)throw new NeedsCredentials();
      if(!transient||attempt>=4)throw new ZoError(code,String(body?.error?.message??'Zo didn’t accept the request.'),transient);
      const after=Number(body?.error?.details?.retry_after_seconds??response?.headers.get('retry-after'));
      await this.sleep(Number.isFinite(after)&&after>0?Math.min(after,60)*1000:1000*2**attempt);
    }
  }
  // Tokens last five minutes. A service account has no refresh token: it exchanges its secret again.
  private async token():Promise<string>{
    if(this.access&&this.access.expires>Date.now()+30_000)return this.access.token;
    const state=this.state;if(!state)throw new NeedsCredentials();
    this.exchanging??=(async()=>{
      const secret=await this.secrets.get(this.account);if(!secret)throw new NeedsCredentials();
      const result=await this.exchange(state.clientId,secret);
      if(result==='rejected')throw new NeedsCredentials();
      this.access=result;return result.token;
    })().finally(()=>{this.exchanging=undefined;});
    return this.exchanging;
  }
  private async exchange(clientId:string,clientSecret:string):Promise<{token:string;expires:number}|'rejected'>{
    for(let attempt=0;;attempt++){
      let response:Response|undefined;
      try{response=await this.fetch(`${this.config.authOrigin}/zo-system-api/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,resource:this.resource}),signal:AbortSignal.timeout(30_000)});}catch{}
      const body=response?await response.json().catch(()=>null) as any:null;
      if(response?.ok&&typeof body?.access_token==='string')return {token:body.access_token,expires:Date.now()+Number(body.expires_in??300)*1000};
      if(response&&[400,401].includes(response.status))return 'rejected';
      if(attempt>=3)throw new ZoError('temporarily_unavailable','Zo is unavailable right now.',true);
      await this.sleep(1000*2**attempt);
    }
  }

  // Connect with the service account's credential, checked with Zo before anything is saved.
  // Choosing the folder is a separate step, unless one is given here.
  async connect(input:{credentials?:unknown;folder?:unknown}):Promise<SyncStatus>{
    const parsed=parseCredentials(String(input.credentials??'')),{clientId,clientSecret}=parsed;
    const folder=input.folder??parsed.folder,chosen=folder===undefined?undefined:normalizeFolder(folder);
    let access:{token:string;expires:number}|'rejected';
    try{access=await this.exchange(clientId,clientSecret);}catch{throw Error('Draft couldn’t reach Zo. Try again in a moment.');}
    if(access==='rejected')throw Error('Zo didn’t accept this credential. Check that you copied the whole file, or create a new credential.');
    const workspaceId=workspaceOf(access.token);
    await this.secrets.set(this.account,clientSecret);
    // A new credential for the same workspace keeps its folder and what is already saved there.
    const previous=this.state?.workspaceId===workspaceId?this.state:null,base=chosen??previous?.base;
    clearTimeout(this.timer);this.timer=undefined;
    this.state={schemaVersion:2,clientId,workspaceId,workspaceName:parsed.workspaceName??previous?.workspaceName,base,files:previous&&previous.base===base?previous.files:{},lastSyncedAt:previous&&previous.base===base?previous.lastSyncedAt:undefined,connectedAt:new Date().toISOString()};
    this.access=access;this.message=undefined;
    try{const workspace=await this.invoke<{display_name?:string}>('zo.workspace.get',{workspace_id:workspaceId});if(workspace.display_name)this.state.workspaceName=workspace.display_name;}catch{}
    await this.save();
    if(base)this.start();else this.phase='choose-folder';
    return this.status();
  }
  private start(){this.phase='waiting';this.startSweep();this.firstChange=Date.now();this.schedule(0);}

  // The folders this service account can see, for choosing where drafts go. With no path, its top-level folders.
  async folders(path?:unknown):Promise<FolderList>{
    if(!this.state)throw Error('Connect a Zo workspace first.');
    const at=path===undefined||path===null||path===''?null:normalizeFolder(path);
    const folders:{name:string;path:string}[]=[];let cursor:string|undefined;
    for(let page=0;page<10;page++){
      let result:{entries:{kind:string;path:string;folder?:{name:string}}[];next_cursor:string|null};
      try{result=await this.invoke('zo.kb.list',at?{path:at}:{},1,cursor?{cursor}:undefined);}
      catch(error){
        if(error instanceof ZoError&&['permission_denied','resource_not_found'].includes(error.code))throw Error(at?`This service account can’t see inside ${at}.`:'This service account can’t see your folders. Open a folder it can use.');
        throw error instanceof ZoError?Error('Draft couldn’t reach Zo. Try again in a moment.'):error;
      }
      for(const entry of result.entries){
        const name=entry.folder?.name??entry.path.split('/').pop()??'';
        // A draft's own package folder is not somewhere to save drafts.
        if(entry.kind==='folder'&&!name.endsWith('.draft'))folders.push({name,path:entry.path});
      }
      if(!result.next_cursor)break;cursor=result.next_cursor;
    }
    folders.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
    const parent=at&&at.split('/').length>2?at.split('/').slice(0,-1).join('/'):null;
    return {path:at,parent,folders};
  }
  async createFolder(parent:unknown,name:unknown):Promise<{name:string;path:string}>{
    if(!this.state)throw Error('Connect a Zo workspace first.');
    const at=normalizeFolder(parent),clean=typeof name==='string'?name.trim().normalize('NFC'):'';
    if(!clean||clean==='.'||clean==='..'||/[\/\u0000-\u001f]/.test(clean)||Buffer.byteLength(clean)>255)throw Error('Use a folder name without slashes.');
    try{await this.invoke('zo.folder.create',{parent_path:at,name:clean,idempotency_key:`draft-folder-${crypto.randomUUID()}`});}
    catch(error){
      if(error instanceof ZoError&&error.code==='conflict')throw Error(`There’s already something named ${clean} here.`);
      if(error instanceof ZoError&&['permission_denied','resource_not_found'].includes(error.code))throw Error('This service account can’t add folders here.');
      throw error instanceof ZoError?Error('Zo couldn’t make the folder. Try again in a moment.'):error;
    }
    return {name:clean,path:`${at}/${clean}`};
  }
  // Save drafts in this folder from now on. A new folder gets its own full copy; the old copy stays in Zo.
  async chooseFolder(path:unknown):Promise<SyncStatus>{
    const state=this.state;if(!state)throw Error('Connect a Zo workspace first.');
    const base=normalizeFolder(path);
    if(base!==state.base){state.base=base;state.files={};state.lastSyncedAt=undefined;await this.save();}
    if(!this.stopped){this.message=undefined;this.start();}
    return this.status();
  }
  // Forget the credential on this Mac. Everything already saved stays in Zo; deleting the service
  // account in Zo revokes it everywhere.
  async disconnect(){
    clearTimeout(this.timer);this.timer=undefined;clearInterval(this.sweep);this.sweep=undefined;
    this.state=null;this.access=undefined;this.phase='off';this.message=undefined;
    await this.secrets.delete(this.account);
    await atomicWrite(this.statePath,JSON.stringify({schemaVersion:2,disconnected:true})+'\n');
    return this.status();
  }
  private async save(){if(this.state)await atomicWrite(this.statePath,JSON.stringify(this.state,null,2)+'\n');}
}
