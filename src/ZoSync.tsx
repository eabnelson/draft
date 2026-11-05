import {useEffect,useRef,useState} from 'react';
import {Cloud,CloudAlert,CloudUpload,LoaderCircle,RefreshCw,Unplug,Check,CircleAlert,ArrowUpRight,FileUp,Folder,FolderPlus,ChevronRight,Copy} from 'lucide-react';
import {Button} from './components/ui/button';
import {api,openLink} from './client';
import type {SyncStatus,FolderList} from '../desktop/zo-sync';
import type {Workspace} from '../desktop/zo-auth';

// How syncing with a Zo workspace is going, read every couple of seconds while Settings is open.
export function useSyncStatus(enabled=true){
  const [status,setStatus]=useState<SyncStatus>();
  useEffect(()=>{
    if(!enabled)return;
    let live=true;const read=()=>void api<SyncStatus>('/api/sync').then(value=>{if(live)setStatus(value);}).catch(()=>{});
    read();const timer=setInterval(read,1500);return()=>{live=false;clearInterval(timer);};
  },[enabled]);
  return [status,setStatus] as const;
}
export function syncLabel(status?:SyncStatus){
  if(!status||status.state==='off')return 'Off';
  if(['needs-credentials','error','choose-folder','choose-workspace','signing-in'].includes(status.state))return 'Needs you';
  return status.workspace??'On';
}
// The icon beside Settings while sync is on: a cloud when everything is in Zo, a cloud with an
// arrow while changes are on their way, and a cloud with a warning when sync needs you.
export function SyncButton({status,onClick}:{status:SyncStatus;onClick:()=>void}){
  const place=status.workspace??'Zo',problem=needsYou(status),moving=status.state==='syncing'||status.state==='waiting';
  const label=problem?'Sync needs you':moving?`Syncing with ${place}`:`Synced with ${place}`;
  return <button type="button" className={`version-tab-bubble settings-bubble sync-bubble ${problem?'is-warning':''} ${status.state==='syncing'?'is-syncing':''}`} aria-label={label} title={label} onClick={onClick}>
    {problem?<CloudAlert size={15}/>:moving?<CloudUpload size={15}/>:<Cloud size={15}/>}
  </button>;
}
function needsYou(status:SyncStatus){return ['error','needs-credentials','choose-folder','choose-workspace','signing-in'].includes(status.state)||(status.state==='synced'&&!!status.message);}
function ago(value?:string){
  if(!value)return '';
  const seconds=Math.max(0,(Date.now()-new Date(value).getTime())/1000);
  if(seconds<45)return 'just now';
  if(seconds<3600)return `${Math.round(seconds/60)} min ago`;
  if(seconds<86400)return `${Math.round(seconds/3600)} hr ago`;
  return new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function line(status:SyncStatus){
  const place=status.workspace??'Zo';
  switch(status.state){
    case 'syncing':return status.pending?`Syncing ${status.pending} ${status.pending===1?'file':'files'} with ${place}…`:`Checking ${place} for changes…`;
    case 'waiting':return `Sync is on. Changes go to ${place} when you pause writing.`;
    case 'synced':return status.message??`Synced with ${place}${status.lastSyncedAt?` · ${ago(status.lastSyncedAt)}`:''}`;
    default:return status.message??'';
  }
}

// Optional workspace setup. The browser issues credentials separately from these grants.
export const SETUP_FOLDER='/workspace/Draft';
export const SETUP_PROMPT=`Prepare my Zo workspace for Draft, my Mac writing app. Use your Zo tools. Draft signs in through the browser; do not create or return a client secret.

1. Workspace: use the Zo workspace you're connected to. If there's more than one, ask me which to use before doing anything.
2. Folder: use ${SETUP_FOLDER}. Create it if it doesn't exist (zo.folder.create with parent_path "/workspace" and name "Draft"). Note its folder ID.
3. Service account: create one named "Draft" with the description "Draft (Mac app) keeps my drafts in sync with ${SETUP_FOLDER}." If one named Draft already exists, ask me before reusing it or changing its grants.
4. Access: give the service account two grants.
   - role_zo_builder at the workspace scope, so it can create files.
   - policy_zo_knowledge_all at the scope of the folder from step 2, so it can update the files in it.
   Do not grant workspace Full access. If folder access cannot be granted, stop and explain what is missing.
5. Tell me the workspace name and folder path. I will return to Draft, choose Connect to Zo, and select the Draft service account on Zo's consent page.`;

// Tokens stay in the desktop host and Keychain; the window only starts sign-in and reads status.
function Connect({onConnected,onCancel,signingIn=false}:{onConnected:(status:SyncStatus)=>void;onCancel?:()=>void;signingIn?:boolean}){
  const [credentials,setCredentials]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false),[showPrompt,setShowPrompt]=useState(false);
  const file=useRef<HTMLInputElement>(null),prompt=useRef<HTMLTextAreaElement>(null);
  async function copy(){
    try{await navigator.clipboard.writeText(SETUP_PROMPT);setCopied(true);setError('');}
    catch{
      setShowPrompt(true);requestAnimationFrame(()=>{prompt.current?.focus();prompt.current?.select();if(document.execCommand('copy')){setCopied(true);setError('');}else setError('Select the prompt and press ⌘C to copy it.');});
    }
  }
  async function connect(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{onConnected(await api<SyncStatus>('/api/sync/connect',{credentials}));setCredentials('');}
    catch(e){setError(e instanceof Error?e.message:'Draft couldn’t connect. Try again.');}
    finally{setBusy(false);}
  }
  async function signIn(){
    setBusy(true);setError('');
    try{onConnected(await api<SyncStatus>('/api/sync/sign-in',{}));}
    catch(e){setError(e instanceof Error?e.message:'Draft couldn’t open Zo. Try again.');}
    finally{setBusy(false);}
  }
  return <div className="zo-sync-connect">
    <p className="settings-detail">Sign in through your browser, then choose a workspace and folder. On Zo’s consent page, choose the Draft service account with access to that folder.</p>
    <div className="settings-actions">
      <Button type="button" size="sm" disabled={busy||signingIn} onClick={()=>void signIn()}>{signingIn?<LoaderCircle size={13} className="spin"/>:<Cloud size={13}/>}<span role="status">{signingIn?'Waiting for Zo…':'Connect to Zo'}</span></Button>
      {signingIn&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>void signIn()}>Start again</Button>}
      {signingIn&&<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>{setBusy(true);void api<SyncStatus>('/api/sync/disconnect',{}).then(onConnected).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Cancel sign-in</Button>}
      {onCancel&&<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>}
    </div>
    <details className="zo-sync-more">
      <summary>First time? Prepare your workspace</summary>
      <p className="settings-detail">Give this prompt to an agent connected to Zo. It creates a Draft service account and grants access to <code>{SETUP_FOLDER}</code>. Then return here to connect.</p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void copy()}>{copied?<Check size={13}/>:<Copy size={13}/>}<span role="status">{copied?'Prompt copied':'Copy setup prompt'}</span></Button>
    <details className="zo-sync-more" open={showPrompt} onToggle={event=>setShowPrompt(event.currentTarget.open)}>
      <summary>See the prompt</summary>
      <textarea ref={prompt} aria-label="Setup prompt" value={SETUP_PROMPT} readOnly rows={10}/>
    </details>
    </details>
    {error&&<div className="inline-error" role="alert">{error}</div>}
    <details className="zo-sync-more">
      <summary>Use an existing service-account credential</summary>
      <form onSubmit={event=>void connect(event)}>
    <label className="zo-sync-field"><span>What your agent gave you</span>
      <textarea aria-label="Setup block from your agent" value={credentials} onChange={e=>setCredentials(e.target.value)} rows={4} spellCheck={false} autoComplete="off" placeholder={'ZO_SYSTEM_API_CLIENT_ID=…\nZO_SYSTEM_API_CLIENT_SECRET=…\nZO_WORKSPACE_NAME=…\nDRAFT_ZO_FOLDER=…'} disabled={busy}/>
    </label>
    <div className="settings-actions">
      <Button type="submit" size="sm" disabled={busy||!credentials.trim()}>{busy?<><LoaderCircle size={13} className="spin"/>Connecting…</>:<><Cloud size={13}/>Connect</>}</Button>
    </div>
      <div className="settings-actions">
        <Button type="button" variant="ghost" size="sm" onClick={()=>void openLink('https://app.zo.computer')}>Open Zo<ArrowUpRight size={12}/></Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>file.current?.click()}><FileUp size={13}/>Choose .env file</Button>
        <input ref={file} type="file" accept=".env,text/plain" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void f.text().then(setCredentials);}}/>
      </div>
      </form>
    </details>
  </div>;
}

function WorkspacePicker({onChosen}:{onChosen:(status:SyncStatus)=>void}){
  const [workspaces,setWorkspaces]=useState<Workspace[]>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>{setError('');void api<Workspace[]>('/api/sync/workspaces').then(setWorkspaces).catch(e=>setError(e.message));};
  useEffect(load,[]);
  async function choose(id:string){setBusy(true);setError('');try{onChosen(await api<SyncStatus>('/api/sync/workspace',{id}));}catch(e){setError(e instanceof Error?e.message:'Choose a workspace again.');}finally{setBusy(false);}}
  return <div className="zo-folder-picker">
    <p className="settings-detail">Choose the workspace for your drafts.</p>
    <ul className="zo-folder-list">{workspaces?.map(w=><li key={w.workspace_id}><button disabled={busy} onClick={()=>void choose(w.workspace_id)}><Cloud size={14}/><span>{w.name}</span><small>{w.subject.type==='service_account'?'Service account':'Your permissions'}</small><ChevronRight size={13}/></button></li>)}</ul>
    {!workspaces&&!error&&<p role="status">Loading workspaces…</p>}
    {workspaces?.length===0&&<p className="settings-detail">No workspaces are authorized. Connect again and approve a workspace.</p>}
    {error&&<div className="inline-error" role="alert">{error}<Button variant="ghost" size="sm" onClick={load}>Try again</Button></div>}
  </div>;
}

// Browse the workspace and pick the folder your drafts are saved in, or make a new one.
function FolderPicker({workspace,current,onChosen,onCancel}:{workspace?:string;current?:string;onChosen:(status:SyncStatus)=>void;onCancel?:()=>void}){
  const start=current?current.split('/').slice(0,-1).join('/')||null:null;
  const [path,setPath]=useState<string|null>(start),[list,setList]=useState<FolderList>(),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [naming,setNaming]=useState(false),[name,setName]=useState('Draft'),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;setLoading(true);setError('');
    api<FolderList>('/api/sync/folders',{path}).then(value=>{if(live)setList(value);}).catch(e=>{if(live){setList(undefined);setError(e instanceof Error?e.message:'Draft couldn’t list your folders.');}}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[path]);
  async function create(event:React.FormEvent){
    event.preventDefault();if(!path)return;setBusy(true);setError('');
    try{const folder=await api<{path:string}>('/api/sync/folders/create',{parent:path,name});setNaming(false);setPath(folder.path);}
    catch(e){setError(e instanceof Error?e.message:'Zo couldn’t make the folder.');}
    finally{setBusy(false);}
  }
  async function choose(){
    if(!path)return;setBusy(true);setError('');
    try{onChosen(await api<SyncStatus>('/api/sync/folder',{path}));}
    catch(e){setError(e instanceof Error?e.message:'Draft couldn’t use this folder.');setBusy(false);}
  }
  const parts=path?path.split('/').slice(1):[];
  return <div className="zo-folder-picker">
    <p className="zo-sync-status"><Folder size={14}/>Choose the folder in {workspace??'your workspace'} to sync your drafts with</p>
    <nav className="zo-folder-path" aria-label="Folder">
      <button type="button" onClick={()=>setPath(null)} disabled={busy}>{workspace??'Zo'}</button>
      {parts.map((part,i)=><span key={i}><ChevronRight size={12} aria-hidden="true"/><button type="button" disabled={busy||i===parts.length-1} onClick={()=>setPath('/'+parts.slice(0,i+1).join('/'))}>{part}</button></span>)}
    </nav>
    <ul className="zo-folder-list" aria-busy={loading}>
      {loading?<li className="zo-folder-empty"><LoaderCircle size={13} className="spin"/>Loading folders…</li>
        :list?.folders.length?list.folders.map(folder=><li key={folder.path}><button type="button" disabled={busy} onClick={()=>setPath(folder.path)}><Folder size={14}/><span>{folder.name}</span>{folder.path===current&&<small>Syncing here</small>}<ChevronRight size={13} className="zo-folder-open"/></button></li>)
        :!error&&<li className="zo-folder-empty">{path?'No folders inside.':'No folders this service account can see.'}</li>}
    </ul>
    {path&&(naming?<form className="zo-folder-new" onSubmit={event=>void create(event)}>
      <input aria-label="New folder name" value={name} onChange={e=>setName(e.target.value)} autoFocus disabled={busy} spellCheck={false}/>
      <Button type="submit" size="sm" variant="outline" disabled={busy||!name.trim()}>Create</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>setNaming(false)}>Cancel</Button>
    </form>:<Button type="button" variant="ghost" size="sm" className="zo-folder-add" disabled={busy||loading} onClick={()=>{setName('Draft');setNaming(true);}}><FolderPlus size={13}/>New folder</Button>)}
    <div className="settings-actions zo-folder-choose">
      <Button size="sm" disabled={busy||!path} onClick={()=>void choose()}>{busy&&!naming?<LoaderCircle size={13} className="spin"/>:<Check size={13}/>}{path?`Sync with ${parts.at(-1)}`:'Open a folder'}</Button>
      {onCancel&&<Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>}
    </div>
    {path&&<p className="settings-detail zo-sync-note">Your drafts sync with <code>{path}</code>. Drafts already in it come to this Mac.{current&&current!==path?' Your old folder keeps its copy.':''}</p>}
    {error&&<div className="inline-error" role="alert">{error}</div>}
  </div>;
}

export function ZoSyncSettings({status,onChange}:{status?:SyncStatus;onChange:(status:SyncStatus)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[changing,setChanging]=useState<'folder'|'credential'|null>(null);
  async function act(path:string){
    setBusy(true);setError('');
    try{onChange(await api<SyncStatus>(path,{}));}
    catch(e){setError(e instanceof Error?e.message:'Something went wrong. Try again.');}
    finally{setBusy(false);}
  }
  if(!status)return null;
  const warning=needsYou(status)&&status.state!=='choose-folder';
  const icon=status.state==='syncing'?<LoaderCircle size={14} className="spin"/>:status.state==='synced'?<Check size={14}/>:warning?<CircleAlert size={14}/>:<Cloud size={14}/>;
  const done=(next:SyncStatus)=>{setChanging(null);onChange(next);};
  let body:React.ReactNode;
  if(status.state==='off'||status.state==='needs-credentials'||status.state==='signing-in'||changing==='credential')body=<>
    {status.state==='needs-credentials'&&<p className="zo-sync-status is-warning" role="status"><CircleAlert size={14}/>{status.message}</p>}
    <Connect signingIn={status.state==='signing-in'} onConnected={done} onCancel={changing?()=>setChanging(null):undefined}/>
  </>;
  else if(status.state==='choose-workspace')body=<><WorkspacePicker onChosen={done}/><Button variant="ghost" size="sm" onClick={()=>void act('/api/sync/sign-in')}>Connect again</Button></>;
  else if(status.state==='choose-folder'||changing==='folder')body=<FolderPicker workspace={status.workspace} current={status.folder} onChosen={done} onCancel={changing?()=>setChanging(null):undefined}/>;
  else body=<>
    <p className={`zo-sync-status ${warning?'is-warning':''}`} role="status">{icon}{line(status)}</p>
    {status.folder&&<p className="zo-sync-folder" title={status.folder}>{status.folder}</p>}
    <div className="settings-actions">
      <Button variant="outline" size="sm" disabled={busy||status.state==='syncing'} onClick={()=>void act('/api/sync/now')}><RefreshCw size={13}/>Sync now</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={()=>setChanging('folder')}><Folder size={13}/>Change folder</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={()=>setChanging('credential')}>Reconnect</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void act('/api/sync/disconnect')}><Unplug size={13}/>Disconnect</Button>
    </div>
  </>;
  return <section className="settings-section zo-sync" aria-label="Sync with Zo">
    <h2>Sync with Zo</h2>
    <p className="settings-detail">{status.folder?'Your drafts are synced with a folder in your Zo workspace, on every Mac you connect.':'Sync your drafts with a folder in your Zo workspace, so they’re on every Mac you connect.'}</p>
    {body}
    {error&&<div className="inline-error" role="alert">{error}</div>}
  </section>;
}
