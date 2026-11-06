// Keeps a Mac's drafts and a folder in a Zo workspace in sync, both ways.
//
// Draft uses browser OAuth with a workspace identity, or an existing service-account credential.
// Zo holds the drafts; each Mac keeps a
// working copy so writing never waits on the network. New drafts, edits, archiving and deleting
// travel in both directions. What changed on only one side is taken from that side; writing
// changed on both sides is kept twice rather than lost (see draft-merge.ts). Changes from Zo are
// written through the draft store, behind your own saves, and the window takes them in when it can
// without moving anything under your cursor. Deletes are recoverable: Zo's trash on one side, the
// Recovery folder on the other.
import {basename,dirname,join} from 'node:path';
import {readdir,readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {atomicWrite,exists,readJSON} from './files';
import {parseDraft,type Draft,type Version} from '../src/model';
import {mergeDrafts} from './draft-merge';
import type {DraftStore,Place} from './documents';
import {ZoAuth,SignInNeeded,ZO_CLIENT_ID,type Workspace} from './zo-auth';
import {openExternalLink} from './links';

export type ZoConfig={authOrigin:string;apiOrigin:string};
export const ZO:ZoConfig={
  authOrigin:process.env.DRAFT_ZO_AUTH_ORIGIN??'https://auth.zo.computer',
  apiOrigin:process.env.DRAFT_ZO_API_ORIGIN??'https://api.zo.computer',
};
export const DEFAULT_FOLDER='/workspace/Draft';
const CLAIMS='https://zo.computer/claims/system-api';
// Wait for a pause in typing so every keystroke is not a new version in Zo, but never hold
// changes back for long. Quiet cloud checks read one small index, not every folder.
export const QUIET_MS=15_000,MAX_WAIT_MS=120_000,CHECK_MS=120_000,IDLE_CHECK_MS=900_000,AUDIT_MS=1_800_000;
export const SYNC_INDEX='Draft-sync.json';
const IDLE_MS=300_000,ACTIVITY_CHECK_MS=15_000;
const INLINE_BYTES=512*1024;
const TRANSIENT=new Set(['authorization_changed','implementation_unavailable','temporarily_unavailable','unavailable','rate_limited','internal_error','timeout']);
const MEDIA_NAME=/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/,VERSION_NAME=/^v\d+\.md$/;
// A draft's file, relative to the folder in Zo: <id>.draft/... for live drafts, Archive/<id>.draft/... for archived ones.
const REL=/^(Archive\/)?([A-Za-z0-9][A-Za-z0-9._-]{0,150})\.draft\/(draft\.json|versions\/v\d+\.md|media\/[a-f0-9]{32}\.(?:png|jpg|webp|gif))$/;
export function parseRel(rel:string):{place:Place;id:string;name:string}|null{const m=REL.exec(rel);return m?{place:m[1]?'archived':'live',id:m[2],name:m[3]}:null;}
const relOf=(id:string,place:Place,name:string)=>`${place==='archived'?'Archive/':''}${id}.draft/${name}`;

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
  async delete(account:string){const result=await this.run(['delete-generic-password','-s',this.service,'-a',account]);if(result.code!==0&&result.code!==44)throw Error('Draft couldn’t remove the credential from your Keychain. Try again.');}
}

// Freedesktop Secret Service (GNOME Keyring/KWallet), isolated by the same profile account.
// Secrets are piped on stdin; they never appear in process arguments or a plaintext file.
export class SecretService implements Secrets {
  constructor(readonly service='Draft Zo sync'){}
  private run(args:string[],input?:string){return new Promise<{code:number;out:string}>((resolve)=>{
    const child=spawn('secret-tool',args,{stdio:['pipe','pipe','ignore']});let out='';
    const timer=setTimeout(()=>child.kill(),15000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>65536)child.kill();});
    child.stdin.on('error',()=>{});child.once('error',()=>{clearTimeout(timer);resolve({code:1,out:''});});
    child.once('close',code=>{clearTimeout(timer);resolve({code:code??1,out});});child.stdin.end(input??'');
  });}
  private attributes(account:string){return ['service',this.service,'account',account];}
  async get(account:string){const value=await this.run(['lookup',...this.attributes(account)]);return value.code===0?value.out.replace(/\n$/,''):null;}
  async set(account:string,value:string){const result=await this.run(['store','--label=Draft sync',...this.attributes(account)],value);if(result.code!==0||await this.get(account)!==value)throw Error('Unlock your system keyring and install libsecret-tools to connect sync.');}
  async delete(account:string){if(!await this.get(account))return;const result=await this.run(['clear',...this.attributes(account)]);if(result.code!==0)throw Error('Draft couldn’t remove the credential from your system keyring.');}
}

export class ZoError extends Error{constructor(readonly code:string,message:string,readonly transient=false){super(message);}}
class NeedsCredentials extends Error{}

type FileState={id:string;revision:number;sha:string;md5?:string;size:number;mtime:number};
// No folder yet means connected, waiting for the person to choose where drafts go.
// baseVersions: each draft's versions as both sides last agreed. deleted: drafts deleted on this Mac
// and removed from Zo, and when. cleanup: emptied folders in Zo still to remove.
type IndexChange={change:string;place:Place|'deleted'};
type IndexHead={id:string;revision:number};
type SyncIndex={schemaVersion:1;generation:string;changes:Record<string,IndexChange>};
type State={schemaVersion:3;auth?:'oauth';clientId:string;workspaceId:string;workspaceName?:string;base?:string;files:Record<string,FileState>;baseVersions?:Record<string,string[]>;deleted?:Record<string,number>;cleanup?:string[];lastSyncedAt?:string;connectedAt:string;indexHead?:IndexHead;pendingIndex?:Record<string,IndexChange>;lastInventoryAt?:number};
type RemoteEntry={id:string;revision:number;updatedAt:number;md5?:string|null};
type KnowledgeEntry={kind:string;path:string;folder?:{name:string};file?:{id:string;revision:number;updated_at?:string};md5?:string|null};
export type SyncStatus={
  state:'off'|'signing-in'|'choose-workspace'|'choose-folder'|'waiting'|'syncing'|'synced'|'needs-credentials'|'error';
  workspace?:string;folder?:string;lastSyncedAt?:string;pending?:number;message?:string;
};
type LocalFile={rel:string;path:string;size:number;mtime:number};
type RemoteFile={id:string;revision:number};
export type FolderList={path:string|null;parent:string|null;folders:{name:string;path:string}[]};
type Fetch=(input:string,init?:RequestInit)=>Promise<Response>;
type Options={secrets?:Secrets;config?:ZoConfig;fetch?:Fetch;sleep?:(ms:number)=>Promise<void>;timers?:boolean;now?:()=>number};

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
  private phase:SyncStatus['state']='off';private message?:string;private notice?:string;private pending=0;
  private firstChange=0;private lastChange=0;private timer?:ReturnType<typeof setTimeout>;private sweep?:ReturnType<typeof setTimeout>;
  private lastActivity:number;private foreground=true;private lastCheck=0;private forceScan=false;private paused=false;
  private indexResponse?:IndexHead&{etag?:string};
  private running?:Promise<void>;private again=false;
  private readonly auth:ZoAuth;
  private folderCache=new Map<string,{entries:KnowledgeEntry[];watermark:number;checkedAt:number}>();
  private readonly secrets:Secrets;private readonly config:ZoConfig;private readonly fetch:Fetch;private readonly sleep:(ms:number)=>Promise<void>;private readonly timers:boolean;private readonly now:()=>number;
  readonly draftsRoot:string;
  constructor(readonly dataRoot:string,readonly store:DraftStore,options:Options={}){
    this.draftsRoot=store.root;
    this.secrets=options.secrets??(process.platform==='linux'?new SecretService():new Keychain());this.config=options.config??ZO;
    this.fetch=options.fetch??((input,init)=>globalThis.fetch(input,init));this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));this.timers=options.timers??true;
    this.now=options.now??Date.now;this.lastActivity=this.now();
    this.auth=new ZoAuth(dataRoot,this.secrets,this.account,this.config,this.fetch);
  }
  private get statePath(){return join(this.dataRoot,'zo-sync.json');}
  // One Keychain item per data folder, so a test or development copy of Draft never uses the real app's credential.
  private get account(){return `client-${sha256(this.dataRoot).slice(0,16)}`;}
  private get resource(){return `${this.config.apiOrigin}/zo-system-api`;}
  private get stopped(){return ['needs-credentials','signing-in','choose-workspace'].includes(this.phase);}

  async initialize(){
    await this.auth.initialize();
    try{if(await exists(this.statePath)){const value=await readJSON<State>(this.statePath);if([2,3].includes((value as {schemaVersion:number})?.schemaVersion)&&typeof value.clientId==='string'&&typeof value.workspaceId==='string')this.state={...value,schemaVersion:3,files:value.files??{}};}}catch{}
    if(!this.state){if(this.auth.enabled)this.phase='choose-workspace';return;}
    if(!this.state.base){this.phase='choose-folder';return;}
    this.phase='waiting';this.startSweep();this.schedule(0);
  }
  status():SyncStatus{
    const s=this.state;
    return {state:this.phase,workspace:s?.workspaceName,folder:s?.base,lastSyncedAt:s?.lastSyncedAt,pending:this.pending||undefined,message:this.message??this.notice};
  }
  // Called after any save. It only notes the change; the upload happens later, off the save path.
  changed(){
    if(!this.state?.base||this.stopped)return;
    const now=this.now();this.lastActivity=now;this.lastChange=now;if(!this.firstChange)this.firstChange=now;
    if(this.phase==='synced')this.phase='waiting';
    if(!this.timer)this.schedule(QUIET_MS);
  }
  syncNow(){if(!this.state)throw Error('Connect a Zo workspace first.');if(!this.state.base)throw Error('Choose a folder in Zo first.');if(this.stopped)throw Error('Connect again with a new credential first.');this.forceScan=true;this.firstChange=this.firstChange||this.now();this.schedule(0);return this.status();}
  activity(reason:'foreground'|'background'|'online'){
    if(reason!=='online')this.foreground=reason==='foreground';
    if(this.foreground)this.lastActivity=this.now();
    if(this.state?.base&&!this.paused&&!this.stopped&&reason!=='background'&&this.now()-this.lastCheck>=ACTIVITY_CHECK_MS)this.schedule(0);
    this.startSweep();return this.status();
  }
  nextCheckDelay(now=this.now()){return this.foreground&&now-this.lastActivity<IDLE_MS?CHECK_MS:IDLE_CHECK_MS;}
  private schedule(ms:number){
    if(!this.timers||this.paused)return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;
      const now=this.now(),quiet=now-this.lastChange>=QUIET_MS,overdue=this.firstChange&&now-this.firstChange>=MAX_WAIT_MS;
      if(ms>0&&!quiet&&!overdue){this.schedule(Math.min(QUIET_MS-(now-this.lastChange),MAX_WAIT_MS-(now-this.firstChange)));return;}
      void this.run(false);
    },ms);
    (this.timer as any)?.unref?.();
  }
  private startSweep(){
    clearTimeout(this.sweep);this.sweep=undefined;
    if(!this.timers||this.paused||!this.state?.base||this.stopped)return;
    this.sweep=setTimeout(()=>{this.sweep=undefined;if(this.firstChange&&this.timer){this.startSweep();return;}void this.run(false);},this.nextCheckDelay());
    (this.sweep as any).unref?.();
  }

  // One pass at a time; a change during a pass runs another one after it.
  run(fullScan=true):Promise<void>{
    this.forceScan||=fullScan;
    if(this.running){this.again=true;return this.running;}
    clearTimeout(this.sweep);this.sweep=undefined;
    this.running=(async()=>{
      do{this.again=false;this.firstChange=0;const full=this.forceScan;this.forceScan=false;await this.pass(full);}while(this.again&&this.state&&!this.stopped&&!this.paused);
    })().finally(()=>{this.running=undefined;this.startSweep();});
    return this.running;
  }
  private async pass(fullScan:boolean){
    const state=this.state;if(!state?.base||this.stopped)return;
    this.phase='syncing';this.message=undefined;this.notice=undefined;
    try{
      let local=this.worthSaving(state,await this.localFiles());
      const head=await this.checkIndex(state);if(this.state!==state)return;
      this.lastCheck=this.now();
      const localPaths=new Set(local.map(f=>f.rel));
      const localWork=local.some(f=>!state.files[f.rel]||state.files[f.rel].size!==f.size||state.files[f.rel].mtime!==f.mtime)||Object.keys(state.files).some(rel=>parseRel(rel)&&!localPaths.has(rel));
      const audit=!state.lastInventoryAt||this.now()-state.lastInventoryAt>=AUDIT_MS;
      const changed=!head||!state.indexHead||head.id!==state.indexHead.id||head.revision!==state.indexHead.revision;
      const inventory=fullScan||audit||changed||localWork||Object.keys(state.pendingIndex??{}).length>0;
      if(fullScan||audit||changed)this.folderCache.clear();
      await this.cleanup(state);
      // Index entries are hints, never authority to delete writing. Actual changes still
      // use complete folder inventories and the existing revision/merge checks.
      const remote=inventory?await this.remoteFiles(state):null;if(this.state!==state)return;
      if(remote&&await this.reconcile(state,local,remote))local=this.worthSaving(state,await this.localFiles());
      if(this.state!==state)return;
      await this.push(state,local);
      if(this.state!==state)return;
      if(!head||Object.keys(state.pendingIndex??{}).length){
        const published=await this.publishIndex(state,head);
        state.indexHead=published.caughtUp?published.head:head??undefined;
        if(!published.caughtUp)this.again=true;
      }else state.indexHead=head;
      if(inventory)state.lastInventoryAt=this.now();
      // What both sides now agree on, to tell later which side added or removed a version.
      const versions:Record<string,string[]>={};
      for(const file of local.filter(f=>f.rel.endsWith('/draft.json'))){try{const record=await readJSON<{id:string;versions:{id:string}[]}>(file.path);versions[record.id]=record.versions.map(v=>v.id);}catch{}}
      state.baseVersions=versions;
      const cutoff=Date.now()-90*86_400_000;state.deleted=Object.fromEntries(Object.entries(state.deleted??{}).filter(([,at])=>at>cutoff));
      state.lastSyncedAt=new Date().toISOString();await this.save();
      this.phase=this.firstChange?'waiting':'synced';
    }catch(error){
      if(this.state!==state)return;
      this.forceScan=true;
      if(error instanceof NeedsCredentials||error instanceof SignInNeeded){this.phase='needs-credentials';this.message=state.auth==='oauth'?'Your Zo sign-in ended. Connect to Zo again.':'Zo no longer accepts this service account. Connect again with a new credential.';return;}
      this.phase='error';
      const code=error instanceof ZoError?error.code:'';
      if(!(error instanceof ZoError))console.error('Draft sync:',error);
      // Zo answers the same way whether a folder is missing or out of reach.
      this.message=code==='quota_exceeded'?`${state.workspaceName??'Your workspace'} is out of storage. Your drafts are safe on this Mac.`
        :code==='permission_denied'||code==='resource_not_found'?`Draft can’t save to ${state.base}. In Zo, give its service account edit access to that folder, then choose Sync now.`
        :code==='conflict'?'A draft changed in Zo while syncing. Draft will merge it on the next check. Your writing is safe on this Mac.'
        :'Draft couldn’t reach Zo. It will try again soon. Your drafts are safe on this Mac.';
      // Missing access needs a person; anything else is tried again in a minute.
      if(this.timers&&code!=='permission_denied'&&code!=='resource_not_found'){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.run(false);},60_000);(this.timer as any).unref?.();}
    }finally{this.pending=0;}
  }

  // Each draft package, live and archived: its record, each version as Markdown, and its images.
  // Undo history stays on this Mac.
  private async localFiles():Promise<LocalFile[]>{
    const files:LocalFile[]=[];
    for(const [folder,prefix] of [[this.draftsRoot,''],[join(this.draftsRoot,'Archive'),'Archive/']] as const){
      if(!await exists(folder))continue;
      for(const entry of await readdir(folder,{withFileTypes:true})){
        if(!entry.isDirectory()||!entry.name.endsWith('.draft'))continue;
        const root=join(folder,entry.name);if(!await exists(join(root,'draft.json')))continue;
        const names=['draft.json'];
        for(const [sub,pattern] of [['versions',VERSION_NAME],['media',MEDIA_NAME]] as const){
          try{for(const name of await readdir(join(root,sub)))if(pattern.test(name))names.push(`${sub}/${name}`);}catch{}
        }
        for(const name of names){const rel=`${prefix}${entry.name}/${name}`;if(!parseRel(rel))continue;try{const info=await stat(join(root,name));if(info.isFile())files.push({rel,path:join(root,name),size:info.size,mtime:info.mtimeMs});}catch{}}
      }
    }
    return files.sort((a,b)=>a.rel.localeCompare(b.rel));
  }
  // A blank draft that was never synced stays on this Mac: Draft opens one on a Mac with no drafts,
  // and it should not follow you to every other Mac.
  private worthSaving(state:State,files:LocalFile[]):LocalFile[]{
    const blank=new Set<string>(),seen=new Map<string,boolean>();
    for(const f of files){const p=parseRel(f.rel)!;const key=`${p.place}:${p.id}`;const empty=(f.rel.endsWith('/draft.json')||(p.name.startsWith('versions/')&&f.size===0))&&!state.files[f.rel];seen.set(key,(seen.get(key)??true)&&empty);}
    for(const [key,empty] of seen)if(empty)blank.add(key);
    return files.filter(f=>{const p=parseRel(f.rel)!;return !blank.has(`${p.place}:${p.id}`);});
  }
  // Enumerate authoritative folder contents. Search indexing is not a sync inventory.
  // Walk only package folders and their versions/media, and refuse an incomplete inventory.
  private async remoteFiles(state:State):Promise<Map<string,RemoteEntry>|null>{
    const folder=await this.folderId(state.base!,false);if(!folder)return null;
    const files=new Map<string,RemoteEntry>(),queue=[state.base!];
    for(let index=0;index<queue.length;index++){
      if(index>20_000)throw Error('Too many folders to finish a sync safely.');
      const path=queue[index];
      for(const entry of await this.listFolder(path)){
        if(!entry.path.startsWith(`${path}/`)||entry.path.slice(path.length+1).includes('/'))throw Error('Zo returned a file outside its folder.');
        const rel=entry.path.slice(state.base!.length+1);
        if(entry.kind==='folder'&&/^(Archive|(?:Archive\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.draft(?:\/(?:versions|media))?)$/.test(rel))queue.push(entry.path);
        if(entry.file&&parseRel(rel)){
          const known=state.files[rel];
          // A metadata-only revision can be acknowledged without downloading unchanged bytes.
          if(known?.id===entry.file.id&&known.md5&&entry.md5===known.md5)known.revision=entry.file.revision;
          files.set(rel,{id:entry.file.id,revision:entry.file.revision,updatedAt:Date.parse(entry.file.updated_at??'')||0,md5:entry.md5});
        }
      }
    }
    return files;
  }
  private async listFolder(path:string):Promise<KnowledgeEntry[]>{
    const key=`${this.state!.workspaceId}:${path}`,cached=this.folderCache.get(key);
    // Discover packages and subfolders every pass. Content-only folders use overlapping
    // timestamp polls between complete inventories, which also discover deletes and moves.
    const incremental=/\.draft\/(versions|media)$/.test(path)&&cached&&cached.watermark>0&&Date.now()-cached.checkedAt<5*60_000;
    const entries:KnowledgeEntry[]=[],seen=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<500;page++){
      const result=await this.invoke<{entries:KnowledgeEntry[];next_cursor:string|null}>('zo.kb.list',{path,details:true},1,{limit:100,...incremental?{filter:{updated_after:new Date(cached.watermark-5000).toISOString()}}:{},...cursor?{cursor}:{}});
      entries.push(...result.entries);
      if(!result.next_cursor){
        const merged=incremental?new Map(cached.entries.map(e=>[e.file?.id??e.path,e])):new Map<string,KnowledgeEntry>();
        for(const entry of entries)merged.set(entry.file?.id??entry.path,entry);
        const result=[...merged.values()],watermark=Math.max(0,...result.map(e=>Date.parse(e.file?.updated_at??'')||0));
        this.folderCache.set(key,{entries:result,watermark,checkedAt:incremental?cached.checkedAt:Date.now()});return result;
      }
      if(seen.has(result.next_cursor))throw Error('Zo repeated a folder page. Sync will try again.');
      cursor=result.next_cursor;seen.add(cursor);
    }
    throw Error('Zo returned an incomplete folder listing. Sync will try again.');
  }
  private async changedHere(state:State,file:LocalFile|undefined):Promise<boolean>{
    if(!file)return false;const known=state.files[file.rel];if(!known)return true;
    if(known.size===file.size&&known.mtime===file.mtime)return false;
    try{return sha256(await readFile(file.path))!==known.sha;}catch{return true;}
  }
  // Zo's search can lag a little behind its files, so a file missing from it is checked by ID
  // before Draft treats it as removed.
  private async goneFromZo(state:State,rels:string[]):Promise<boolean>{
    for(const rel of rels){
      const known=state.files[rel];if(!known)continue;
      try{const file=await this.invoke<{deleted_at?:string|null}>('zo.file.get_metadata',{file_id:known.id});if(!file.deleted_at)return false;}
      catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;}
    }
    return true;
  }

  // Bring each draft's two copies together: deleted, archived, or changed on either side. Writes
  // to this Mac go through the draft store, so they wait their turn behind your own saves.
  private async reconcile(state:State,localList:LocalFile[],remote:Map<string,RemoteEntry>):Promise<boolean>{
    const group=(rels:Iterable<string>)=>{const m=new Map<string,string[]>();for(const rel of rels){const p=parseRel(rel);if(p)m.set(p.id,[...m.get(p.id)??[],rel]);}return m;};
    const local=new Map(localList.map(f=>[f.rel,f])),L=group(local.keys()),R=group(remote.keys()),K=group(Object.keys(state.files));
    const placeOf=(rels:string[])=>rels.length?parseRel(rels[0])!.place:null;
    const deletedHere=await this.store.deletedIds();state.deleted??={};
    let touched=false;const goneThere:string[]=[];
    for(const id of new Set([...L.keys(),...R.keys(),...K.keys()])){
      if(this.state!==state)return touched;
      const l=L.get(id)??[],r=R.get(id)??[],k=K.get(id)??[],lp=placeOf(l),rp=placeOf(r);
      if(!lp){
        const deletedAt=state.deleted[id]??(k.length?deletedHere.get(id):undefined);
        // Written in Zo since: that wins over the delete, and the draft comes back.
        const writtenThere=r.some(rel=>{const f=remote.get(rel)!,known=state.files[rel];return state.deleted![id]?f.updatedAt>state.deleted![id]:!known||known.revision!==f.revision;});
        if(deletedAt&&!writtenThere){if(r.length||k.length)await this.deleteRemote(state,id,[...new Set([...r,...k])],remote);continue;}
        if(!r.length){for(const rel of k)delete state.files[rel];continue;}
        if(!r.some(rel=>rel.endsWith('/draft.json')))continue;
        await this.pull(state,id,rp!,null,local,remote,r);delete state.deleted[id];touched=true;continue;
      }
      if(!r.length){
        // New on this Mac: saved to Zo below.
        if(!k.length)continue;
        if(!await this.goneFromZo(state,k.filter(rel=>rel.endsWith('/draft.json'))))continue;
        let written=false;for(const rel of l)if(await this.changedHere(state,local.get(rel))){written=true;break;}
        // Written in here since it was deleted in Zo: that wins, and it is saved to Zo again.
        if(written){for(const rel of k)delete state.files[rel];continue;}
        goneThere.push(id);continue;
      }
      let place=lp;
      if(lp!==rp){
        // Archived or restored on one side: the other follows.
        if(placeOf(k)===lp){
          await this.store.moveExternal(id,rp!);
          for(const rel of k){const p=parseRel(rel)!;state.files[relOf(id,rp!,p.name)]=state.files[rel];delete state.files[rel];}
          await this.save();this.again=true;touched=true;continue;
        }
        await this.moveRemote(state,id,rp!,lp,remote);place=lp;
      }
      const rels=[...remote.keys()].filter(rel=>parseRel(rel)?.id===id);
      const changedThere=rels.some(rel=>state.files[rel]?.revision!==remote.get(rel)!.revision);
      let removedThere=false;
      const missing=Object.keys(state.files).filter(rel=>parseRel(rel)?.id===id&&!remote.has(rel)&&local.has(rel));
      if(missing.length&&await this.goneFromZo(state,missing))removedThere=true;
      if(!changedThere&&!removedThere)continue;
      await this.pull(state,id,place,await this.store.readAt(id,place),local,remote,rels);touched=true;
    }
    // A folder that empties all at once is more likely moved or lost than deliberately cleared, so
    // a large share of drafts disappearing from Zo waits for a person instead of being deleted here.
    const known=new Set([...K.keys()]).size;
    if(goneThere.length>2&&goneThere.length*3>known){this.notice=`${goneThere.length} drafts are missing from ${state.base} in Zo. Draft kept them on this Mac. If you deleted them in Zo on purpose, delete them here too.`;return touched;}
    for(const id of goneThere){await this.store.removeExternal(id);for(const rel of K.get(id)??[])delete state.files[rel];touched=true;}
    return touched;
  }

  // Take a draft from Zo, merged with this Mac's copy (mine) if there is one. Only what this Mac
  // changed and Zo did not is kept from here; what Zo changed comes in; writing changed on both
  // sides is kept twice, as a new version.
  private async pull(state:State,id:string,place:Place,mine:Draft|null,local:Map<string,LocalFile>,remote:Map<string,RemoteEntry>,rels:string[]){
    const at=(name:string)=>relOf(id,place,name),downloaded=new Map<string,{bytes:Buffer;revision:number;id:string}>();
    const fetchFile=async(rel:string)=>{const got=await this.download(remote.get(rel)!.id);downloaded.set(rel,got);return got.bytes;};
    const recordRel=at('draft.json');if(!remote.has(recordRel))return;
    const record=JSON.parse((await fetchFile(recordRel)).toString('utf8'));
    const texts:Record<string,string>={};
    for(const v of Array.isArray(record?.versions)?record.versions:[]){
      const rel=at(`versions/v${v?.number}.md`),entry=remote.get(rel);
      // Not in Zo: this Mac's copy stands in, and is saved there again.
      if(!entry){const here=local.get(rel);if(here)texts[v.id]=await readFile(here.path,'utf8');continue;}
      const known=state.files[rel],here=local.get(rel);
      texts[v.id]=known&&known.revision===entry.revision&&here&&!await this.changedHere(state,here)?await readFile(here.path,'utf8'):(await fetchFile(rel)).toString('utf8');
    }
    let theirs:Draft;
    try{theirs=parseDraft(record,texts);}catch(error){console.error(`Draft sync skipped ${id} from Zo:`,error);return;}
    const changedThere=(v:Version)=>{const rel=at(`versions/v${v.number}.md`),known=state.files[rel];return !known||known.revision!==remote.get(rel)?.revision;};
    const changedHere=(v:Version)=>{const known=state.files[at(`versions/v${v.number}.md`)];return !known||sha256(v.text)!==known.sha;};
    const merged=mine?mergeDrafts(
      {draft:mine,metaChanged:await this.changedHere(state,local.get(recordRel)),changed:changedHere},
      {draft:theirs,metaChanged:state.files[recordRel]?.revision!==remote.get(recordRel)!.revision,changed:changedThere},
      new Set(state.baseVersions?.[id]??[])):theirs;
    for(const rel of rels){const name=parseRel(rel)!.name;if(name.startsWith('media/')&&!local.has(rel))await this.store.writeMediaExternal(id,place,name.slice(6),await fetchFile(rel));}
    await this.store.writeExternal(merged,place);
    // Zo's copy is now the known one: anything the merge kept from this Mac differs from it and is
    // saved back to Zo by the push that follows.
    for(const [rel,got] of downloaded)state.files[rel]={id:got.id,revision:got.revision,sha:sha256(got.bytes),md5:createHash('md5').update(got.bytes).digest('hex'),size:-1,mtime:-1};
    await this.save();
  }
  private async download(fileId:string):Promise<{bytes:Buffer;revision:number;id:string}>{
    const read=await this.invoke<{file:{id:string;revision:number};content:{format:string;url?:string;text?:string}}>('zo.file.read',{file_id:fileId,format:'url'});
    if(read.content.format==='text'&&typeof read.content.text==='string')return {bytes:Buffer.from(read.content.text,'utf8'),revision:read.file.revision,id:read.file.id};
    for(let attempt=0;;attempt++){
      let response:Response|undefined;try{response=await this.fetch(read.content.url!,{signal:AbortSignal.timeout(120_000)});}catch{}
      if(response?.ok)return {bytes:Buffer.from(await response.arrayBuffer()),revision:read.file.revision,id:read.file.id};
      if(attempt>=3)throw new ZoError('download_failed','The download from Zo didn’t finish.',true);
      await this.sleep(1000*2**attempt);
    }
  }
  // Deleted on this Mac: into Zo's trash, then cleared, with its folders removed once Zo lets them go.
  private async deleteRemote(state:State,id:string,rels:string[],remote:Map<string,RemoteEntry>){
    await this.markIndex(state,id,'deleted');
    for(const rel of rels){
      const fileId=remote.get(rel)?.id??state.files[rel]?.id;
      if(fileId){
        try{await this.invoke('zo.file.delete',{file_id:fileId});}catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;}
        try{await this.invoke('zo.file.purge',{file_id:fileId});}catch{}
      }
      delete state.files[rel];
    }
    const packages=new Set(rels.map(rel=>{const p=parseRel(rel)!;return `${state.base}/${p.place==='archived'?'Archive/':''}${id}.draft`;}));
    state.cleanup=[...new Set([...state.cleanup??[],...[...packages].flatMap(p=>[`${p}/versions`,`${p}/media`,p])])];
    state.deleted![id]=Date.now();await this.save();
  }
  private async cleanup(state:State){
    const left:string[]=[];
    for(const path of state.cleanup??[]){
      if(left.length>=50){left.push(path);continue;}
      try{await this.invoke('zo.folder.delete',{path});}catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))left.push(path);}
    }
    if(left.length!==(state.cleanup??[]).length){state.cleanup=left;await this.save();}
  }
  // Archived or restored here: the draft's folder in Zo moves to match, keeping each file's history.
  private async moveRemote(state:State,id:string,from:Place,to:Place,remote:Map<string,RemoteEntry>){
    await this.markIndex(state,id,to);
    const destination=await this.folderId(to==='archived'?`${state.base}/Archive`:state.base!,true);
    try{await this.invoke('zo.folder.update',{path:`${state.base}/${from==='archived'?'Archive/':''}${id}.draft`,destination_folder_id:destination});}
    catch(error){if(!(error instanceof ZoError&&['conflict','resource_not_found'].includes(error.code)))throw error;}
    const rekey=(rel:string)=>{const p=parseRel(rel);return p&&p.id===id&&p.place===from?relOf(id,to,p.name):null;};
    for(const rel of Object.keys(state.files)){const next=rekey(rel);if(next){state.files[next]=state.files[rel];delete state.files[rel];}}
    for(const [rel,entry] of [...remote]){const next=rekey(rel);if(next){remote.set(next,entry);remote.delete(rel);}}
    await this.save();
  }
  private async folderId(path:string,create:boolean):Promise<string|null>{
    for(let attempt=0;attempt<2;attempt++){
      try{const listed=await this.invoke<{folder?:{id:string}}>('zo.kb.list',{path});if(listed.folder?.id)return listed.folder.id;}
      catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;}
      if(!create)return null;
      const parent=path.split('/').slice(0,-1).join('/'),name=path.split('/').pop()!;
      try{await this.invoke('zo.folder.create',{parent_path:parent,name,create_parent_folders:true,idempotency_key:`draft-folder-${sha256(`${this.state?.workspaceId}:${path}`).slice(0,40)}`});}
      catch(error){if(!(error instanceof ZoError&&error.code==='conflict'))throw error;}
    }
    throw new ZoError('resource_not_found',`Zo couldn’t make ${path}.`);
  }

  // Everything changed on this Mac goes up, and versions removed from a draft here are removed there.
  private async push(state:State,files:LocalFile[]){
    const changed:{file:LocalFile;bytes:Buffer;sha:string}[]=[];
    for(const file of files){
      const known=state.files[file.rel];
      if(known&&known.size===file.size&&known.mtime===file.mtime)continue;
      let bytes:Buffer;try{bytes=await readFile(file.path);}catch{continue;}
      const sha=sha256(bytes);
      if(known?.sha===sha){state.files[file.rel]={...known,size:file.size,mtime:file.mtime};continue;}
      changed.push({file,bytes,sha});
    }
    const here=new Set(files.map(f=>f.rel)),packages=new Set(files.map(f=>{const p=parseRel(f.rel)!;return `${p.place}:${p.id}`;}));
    const removed=Object.keys(state.files).filter(rel=>{const p=parseRel(rel);return p&&!here.has(rel)&&packages.has(`${p.place}:${p.id}`);});
    const index=Buffer.from(await this.index(files)),indexSha=sha256(index);
    if(state.files['Drafts.md']?.sha!==indexSha)changed.push({file:{rel:'Drafts.md',path:'',size:index.length,mtime:0},bytes:index,sha:indexSha});
    this.pending=changed.length+removed.length;
    for(const item of changed){
      if(this.state!==state)return;
      const draft=parseRel(item.file.rel);if(draft)await this.markIndex(state,draft.id,draft.place);
      const remote=await this.upload(state,item.file.rel,item.bytes,item.sha);
      state.files[item.file.rel]={...remote,sha:item.sha,md5:createHash('md5').update(item.bytes).digest('hex'),size:item.file.size,mtime:item.file.mtime};
      this.pending--;await this.save();
    }
    for(const rel of removed){
      if(this.state!==state)return;
      const draft=parseRel(rel)!;await this.markIndex(state,draft.id,draft.place);
      try{await this.invoke('zo.file.delete',{file_id:state.files[rel].id});}catch(error){if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;}
      delete state.files[rel];this.pending--;await this.save();
    }
  }
  private async markIndex(state:State,id:string,place:IndexChange['place']){
    state.pendingIndex??={};
    state.pendingIndex[id]={change:crypto.randomUUID(),place};
    // Persist before touching cloud files. A crash or failed index write is announced
    // on the next successful pass, even when the file upload already completed.
    await this.save();
  }
  private async checkIndex(state:State):Promise<IndexHead|null>{
    try{
      const response=await this.request<IndexHead>('zo.file.get_metadata',{path:`${state.base}/${SYNC_INDEX}`},1,undefined,{etag:this.indexResponse?.etag});
      if(response.notModified){if(!this.indexResponse)throw Error('Missing cached sync index.');return this.indexResponse;}
      const head=response.result!;
      if(typeof head.id!=='string'||!Number.isSafeInteger(head.revision)||head.revision<1)throw Error('MyCloud returned an invalid sync index revision.');
      this.indexResponse={id:head.id,revision:head.revision,etag:response.etag};return this.indexResponse;
    }catch(error){if(error instanceof ZoError&&error.code==='resource_not_found'){this.indexResponse=undefined;return null;}throw error;}
  }
  private async publishIndex(state:State,observed:IndexHead|null){
    const pending={...state.pendingIndex};
    let existing=observed!==null;
    for(let attempt=0;attempt<5;attempt++){
      let file:IndexHead|undefined,changes:SyncIndex['changes']={};
      if(existing){
        try{
          const read=await this.invoke<{file:IndexHead;content:{format:string;text?:string}}>('zo.file.read',{path:`${state.base}/${SYNC_INDEX}`,format:'text'});
          if(read.content.format!=='text'||!read.content.text||read.content.text.length>100_000)throw Error('Draft’s cloud sync index is invalid. Your writing is safe on this Mac.');
          const index=JSON.parse(read.content.text) as SyncIndex;
          if(index.schemaVersion!==1||typeof index.generation!=='string'||!index.changes||Array.isArray(index.changes)||typeof index.changes!=='object')throw Error('Draft’s cloud sync index could not be read. Your writing is safe on this Mac.');
          for(const [id,change] of Object.entries(index.changes))if(/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(id)&&change&&typeof change.change==='string'&&['live','archived','deleted'].includes(change.place))changes[id]=change;
          file=read.file;
        }catch(error){if(error instanceof ZoError&&error.code==='resource_not_found')existing=false;else throw error;}
      }
      // Bounded recent changes plus a new generation invalidate every older checkpoint.
      // Full inventories, not retained tombstones, recover clients offline for longer.
      for(const id of Object.keys(pending))delete changes[id];
      const index:SyncIndex={schemaVersion:1,generation:crypto.randomUUID(),changes:Object.fromEntries(Object.entries({...changes,...pending}).slice(-128))};
      const content=JSON.stringify(index),key=`draft-index-${sha256(`${state.workspaceId}:${state.base}:${content}:${file?.revision??0}`)}`;
      try{
        const head=file?await this.invoke<IndexHead>('zo.file.update',{file_id:file.id,content,expected_revision:file.revision,idempotency_key:key}):await this.invoke<IndexHead>('zo.file.create',{parent_path:state.base,create_parent_folders:true,name:SYNC_INDEX,content,idempotency_key:key});
        for(const [id,change] of Object.entries(pending))if(state.pendingIndex?.[id]?.change===change.change)delete state.pendingIndex[id];
        const caughtUp=file?file.id===observed?.id&&file.revision===observed.revision:observed===null;
        return {head,caughtUp};
      }catch(error){if(!(error instanceof ZoError&&error.code==='conflict'))throw error;existing=true;}
    }
    throw new ZoError('conflict','Another Mac is updating Draft’s sync index. Draft will check again.');
  }
  // A readable list at the top of the folder, so a person or agent in Zo can find a draft by title.
  private async index(files:LocalFile[]){
    const rows:string[]=[];
    for(const file of files.filter(f=>f.rel.endsWith('/draft.json')&&parseRel(f.rel)?.place==='live')){
      let title='';try{title=String((await readJSON<{title?:unknown}>(file.path)).title??'').trim();}catch{}
      rows.push(`- ${(title||'Untitled').replace(/[\r\n]+/g,' ')} — \`${dirname(file.rel)}\``);
    }
    rows.sort((a,b)=>a.localeCompare(b));
    return `# Drafts\n\nDraft keeps your drafts here and on each Mac you connect. Each folder is one draft: \`draft.json\`, and every version as Markdown in \`versions/\`. Archived drafts are in \`Archive/\`.\n\n${rows.join('\n')}\n`;
  }
  private async upload(state:State,rel:string,bytes:Buffer,sha:string):Promise<RemoteFile>{
    const path=`${state.base}/${rel}`,known=state.files[rel],key=(step:string,revision=0)=>`draft-${step}-${sha256(`${state.workspaceId}:${state.base}/${rel}:${sha}:${revision}`).slice(0,48)}`;
    const text=!rel.includes('/media/')&&bytes.length<=INLINE_BYTES?bytes.toString('utf8'):null;
    const replace=async(file:RemoteFile):Promise<RemoteFile>=>{
      try{return await this.replace(file,bytes,text,key('update',file.revision));}
      catch(error){
        // Leave both copies intact. The next pass rereads and merges concurrent writing.
        if(error instanceof ZoError&&error.code==='conflict')this.again=false;
        throw error;
      }
    };
    if(known){
      try{return await replace(known);}
      catch(error){
        // This readable summary is derived from the reconciled library, not writing.
        // Another Mac can regenerate it too; refresh its revision before replacing it.
        if(rel==='Drafts.md'&&error instanceof ZoError&&error.code==='conflict')return replace(await this.invoke<RemoteFile>('zo.file.get_metadata',{path}));
        if(!(error instanceof ZoError&&error.code==='resource_not_found'))throw error;
      }
    }
    for(let attempt=0;;attempt++){
      try{return await this.create(dirname(path),basename(path),bytes,text,key('create'));}
      catch(error){
        if(!(error instanceof ZoError&&error.code==='conflict'))throw error;
        try{
          const found=await this.invoke<RemoteFile>('zo.file.get_metadata',{path});
          // A file appeared after the inventory. Reconcile it before writing over its text.
          if(parseRel(rel))throw error;
          return await replace(found);
        }
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
    return (await this.request<T>(action,input,version,query)).result!;
  }
  private async request<T>(action:string,input:Record<string,unknown>,version:number,query?:Record<string,unknown>,read?:{etag?:string}):Promise<{result?:T;etag?:string;notModified?:boolean}>{
    let renewed=false;
    for(let attempt=0;;attempt++){
      const token=await this.token();
      let response:Response|undefined;
      const url=read?`${this.config.apiOrigin}/zo-system-api/v1/invoke/${encodeURIComponent(this.state!.workspaceId)}/v${version}/${action}?${new URLSearchParams({input:JSON.stringify(input)})}`:`${this.config.apiOrigin}/zo-system-api/v1/invoke`;
      try{response=await this.fetch(url,{method:read?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(read?(read.etag?{'If-None-Match':read.etag}:{}):{'Content-Type':'application/json',...(this.state?.auth==='oauth'?{'Zo-Workspace-Id':this.state.workspaceId}:{})})},...(read?{}:{body:JSON.stringify({action,input,options:query?{version,query}:{version}})}),signal:AbortSignal.timeout(90_000)});}catch{}
      if(response?.status===401&&!renewed){renewed=true;this.access=undefined;this.auth.invalidate();attempt--;continue;}
      if(read&&response?.status===304)return {notModified:true};
      const body=response?await response.json().catch(()=>null) as any:null;
      if(response?.ok&&body&&'result' in body)return {result:body.result as T,etag:response.headers.get('etag')??undefined};
      const code=String(body?.error?.code??(response?`http_${response.status}`:'network')),transient=!response||response.status>=500||response.status===429||TRANSIENT.has(code);
      if(response?.status===401)throw new NeedsCredentials();
      if(!transient||attempt>=4)throw new ZoError(code,String(body?.error?.message??'Zo didn’t accept the request.'),transient);
      const after=Number(body?.error?.details?.retry_after_seconds??response?.headers.get('retry-after'));
      await this.sleep(Number.isFinite(after)&&after>0?Math.min(after,60)*1000:1000*2**attempt);
    }
  }
  // Tokens last five minutes. A service account has no refresh token: it exchanges its secret again.
  private async token():Promise<string>{
    if(this.state?.auth==='oauth')return this.auth.token();
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
  async signIn(open:(url:string)=>Promise<void>=openExternalLink):Promise<SyncStatus>{
    await this.pause();this.phase='signing-in';this.message=undefined;
    try{
      if(this.auth.enabled)await this.auth.disconnect();
      const url=await this.auth.begin(async error=>{
        if(error){this.phase='needs-credentials';this.message=error.message;return;}
        this.state=null;this.access=undefined;
        await atomicWrite(this.statePath,JSON.stringify({schemaVersion:3,disconnected:true})+'\n');
        await this.secrets.delete(this.account);
        this.phase='choose-workspace';this.message=undefined;
      });
      await open(url);return this.status();
    }catch(error){this.auth.cancel();this.phase='needs-credentials';this.message=error instanceof Error?error.message:'Could not open Zo.';throw error;}
  }
  async workspaces():Promise<Workspace[]>{return this.auth.workspaces();}
  async chooseWorkspace(id:unknown):Promise<SyncStatus>{
    const workspace=(await this.auth.workspaces()).find(w=>w.workspace_id===id);
    if(!workspace)throw Error('Choose a workspace you approved in Zo.');
    await this.pause();
    this.folderCache.clear();
    this.state={schemaVersion:3,auth:'oauth',clientId:ZO_CLIENT_ID,workspaceId:workspace.workspace_id,workspaceName:workspace.name,files:{},connectedAt:new Date().toISOString()};
    this.phase='choose-folder';this.message=undefined;await this.save();return this.status();
  }
  private async pause(){
    this.paused=true;
    clearTimeout(this.timer);this.timer=undefined;clearTimeout(this.sweep);this.sweep=undefined;
    this.again=false;await this.running;
    clearTimeout(this.timer);this.timer=undefined;clearTimeout(this.sweep);this.sweep=undefined;this.indexResponse=undefined;
  }
  // Stop background work when an embedding host closes, retaining its connection.
  async close(){await this.pause();this.auth.cancel();}
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
    await this.pause();this.auth.cancel();this.folderCache.clear();
    await this.secrets.set(this.account,clientSecret);
    // A new credential for the same workspace keeps its folder and what is already saved there.
    const previous=this.state?.workspaceId===workspaceId?this.state:null,base=chosen??previous?.base;
    clearTimeout(this.timer);this.timer=undefined;
    const same=previous&&previous.base===base?previous:null;
    this.state={schemaVersion:3,clientId,workspaceId,workspaceName:parsed.workspaceName??previous?.workspaceName,base,files:same?.files??{},baseVersions:same?.baseVersions,deleted:same?.deleted,cleanup:same?.cleanup,lastSyncedAt:same?.lastSyncedAt,indexHead:same?.indexHead,pendingIndex:same?.pendingIndex,lastInventoryAt:same?.lastInventoryAt,connectedAt:new Date().toISOString()};
    this.access=access;this.message=undefined;
    try{const workspace=await this.invoke<{display_name?:string}>('zo.workspace.get',{workspace_id:workspaceId});if(workspace.display_name)this.state.workspaceName=workspace.display_name;}catch{}
    await this.save();
    if(base)this.start();else this.phase='choose-folder';
    return this.status();
  }
  private start(){this.paused=false;this.phase='waiting';this.startSweep();this.firstChange=this.now();this.schedule(0);}

  // The folders this service account can see, for choosing where drafts go. With no path, its top-level folders.
  async folders(path?:unknown):Promise<FolderList>{
    if(!this.state)throw Error('Connect a Zo workspace first.');
    const at=path===undefined||path===null||path===''?null:normalizeFolder(path);
    const folders:{name:string;path:string}[]=[],seen=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<500;page++){
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
      if(!result.next_cursor)break;
      if(page===499||seen.has(result.next_cursor))throw Error('Zo could not finish listing folders. Try again.');
      cursor=result.next_cursor;seen.add(cursor);
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
  // Sync with this folder from now on. Drafts already in it come to this Mac, and this Mac's go to it;
  // the old folder keeps its copy.
  async chooseFolder(path:unknown):Promise<SyncStatus>{
    const state=this.state;if(!state)throw Error('Connect a Zo workspace first.');
    const base=normalizeFolder(path);
    await this.pause();
    this.folderCache.clear();
    if(base!==state.base){state.base=base;state.files={};state.baseVersions=undefined;state.deleted=undefined;state.lastSyncedAt=undefined;state.indexHead=undefined;state.pendingIndex=undefined;state.lastInventoryAt=undefined;await this.save();}
    if(!this.stopped){this.message=undefined;this.start();}
    return this.status();
  }
  // Forget the credential on this Mac. The drafts stay here, and everything already in Zo stays
  // there; deleting the service account in Zo revokes it everywhere.
  async disconnect(){
    await this.pause();
    await this.auth.disconnect();
    this.folderCache.clear();
    this.state=null;this.access=undefined;this.phase='off';this.message=undefined;
    await this.secrets.delete(this.account);
    await atomicWrite(this.statePath,JSON.stringify({schemaVersion:2,disconnected:true})+'\n');
    return this.status();
  }
  private async save(){if(this.state)await atomicWrite(this.statePath,JSON.stringify(this.state,null,2)+'\n');}
}
