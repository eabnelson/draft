import {useEffect,useState,useRef} from 'react';
import {AppearanceSetting,ShortcutList} from './AppearanceSwitch';
import {ArrowUpRight,ArrowUp,Plus,Download,RefreshCw,RotateCcw,Folder,Check,LoaderCircle,Trash2,Copy,X} from 'lucide-react';
import {ContextMenu} from './ContextMenu';
import {savedAppearance} from './theme';
import {Button} from './components/ui/button';
import {api,restartApp} from './client';
import {ModelSettings} from './ModelSettings';
import {MacPreferences} from './MacPreferences';
import {FeatureHandoff,type HandoffTarget} from './FeatureHandoff';
import {OfficialUpdate} from './OfficialUpdate';
import {timeRemaining} from '../desktop/feature-queue';
import type {FeaturesState,Feature,Update,UpdateKind} from '../desktop/types';

const date=(value:string,time=false)=>new Date(value).toLocaleString(undefined,time?{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',year:'numeric'});
const busy=(u:Update)=>['checking','preparing','building','applying'].includes(u.state);
const canContinue=(u:Update)=>['add','remove','batch'].includes(u.kind)&&!busy(u)&&!u.reconnectProvider;
function status(u:Update){
  switch(u.state){
    case 'checking':case 'preparing':case 'building':return timeRemaining(u);
    case 'ready':return 'Ready when you are.';
    case 'applying':return 'Restarting Draft…';
    case 'applied':return u.kind==='reset'?'Back to official Draft':'Your app is up to date';
    case 'failed':return u.reconnectProvider?u.reconnectedAt?'Signed in again.':'Sign-in needed.':'This update needs a little more work.';
    case 'needs-attention':return 'A few choices for your update.';
    case 'cancelled':return 'Update cancelled';
    case 'already-exists':return 'Draft already does this.';
  }
}
// The parts of Settings, in sidebar order. Each opens as a column, like a version of a draft.
export type SectionId='customize'|'changes'|'official'|'updates'|'appearance'|'mac'|'shortcuts'|'ai'|'files';
export const SECTIONS:SectionId[]=['customize','changes','official','updates','appearance','mac','shortcuts','ai','files'];
const SETTINGS_KEY='draft:settings';
function savedColumns():{open:SectionId[];active:SectionId}{
  try{const value=JSON.parse(localStorage.getItem(SETTINGS_KEY)??'null');const open=(value?.open as unknown[]).filter((id):id is SectionId=>SECTIONS.includes(id as SectionId));if(open.length)return {open,active:open.includes(value.active)?value.active:open[0]};}catch{}
  return {open:['customize'],active:'customize'};
}
export function Features({onBeforeApply,onUpdating,sidebar=true,footer}:{onBeforeApply:()=>Promise<boolean>;onUpdating:(value:boolean)=>void;sidebar?:boolean;footer?:React.ReactNode}){
  const [data,setData]=useState<FeaturesState>(),[request,setRequest]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[settings,setSettings]=useState(false),[submitting,setSubmitting]=useState(false),[applying,setApplying]=useState(false);
  const [handoffTarget,setHandoffTarget]=useState<HandoffTarget>();
  const [reconnecting,setReconnecting]=useState('');
  const mounted=useRef(true),handoffTrigger=useRef<HTMLElement|null>(null),columnsRef=useRef<HTMLDivElement>(null);
  const [columns,setColumns]=useState(savedColumns),[menu,setMenu]=useState<{x:number;y:number;id:SectionId}|null>(null);
  const open=columns.open,active=columns.active;
  useEffect(()=>{localStorage.setItem(SETTINGS_KEY,JSON.stringify(columns));},[columns]);
  const setActive=(id:SectionId)=>setColumns(current=>current.active===id?current:{...current,active:id});
  // Clicking a section opens its column beside the others (or goes to it if it is already open).
  function openSection(id:SectionId){
    setColumns(current=>({open:current.open.includes(id)?current.open:[...current.open,id],active:id}));
    requestAnimationFrame(()=>columnsRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'}));
  }
  // ⌘W or Close tab closes a section's column; the last one stays open.
  function closeSection(id:SectionId){
    setColumns(current=>{if(current.open.length<2||!current.open.includes(id))return current;const at=current.open.indexOf(id),next=current.open.filter(x=>x!==id);return {open:next,active:current.active===id?next[Math.min(at,next.length-1)]:current.active};});
  }
  const closeRef=useRef(closeSection);closeRef.current=closeSection;
  const activeRef=useRef(active);activeRef.current=active;
  useEffect(()=>{
    const close=()=>closeRef.current(activeRef.current);
    // ⌃Tab and ⌃⇧Tab move between the open sections, like versions.
    const cycle=(e:Event)=>setColumns(current=>{const step=(e as CustomEvent<number>).detail,at=current.open.indexOf(current.active);return {...current,active:current.open[(at+step+current.open.length)%current.open.length]};});
    window.addEventListener('draft:settings-close-tab',close);window.addEventListener('draft:settings-cycle',cycle);
    return()=>{window.removeEventListener('draft:settings-close-tab',close);window.removeEventListener('draft:settings-cycle',cycle);};
  },[]);
  async function refresh(){try{const value=await api<FeaturesState>('/api/features');if(mounted.current){setData(value);setLoadError('');}}catch{if(mounted.current)setLoadError('Draft couldn’t load your features. Try again in a moment.');}}
  useEffect(()=>{mounted.current=true;void refresh();const interval=setInterval(()=>void refresh(),1000);return()=>{mounted.current=false;clearInterval(interval);};},[]);
  useEffect(()=>{const check=()=>void checkOfficial();window.addEventListener('draft:check-updates',check);if(new URLSearchParams(location.search).has('check'))check();return()=>window.removeEventListener('draft:check-updates',check);},[]);
  useEffect(()=>{const failed=()=>{setApplying(false);onUpdating(false);setError('Draft restored your previous app. Your writing is safe.');void refresh();};window.addEventListener('draft:update-failed',failed);return()=>window.removeEventListener('draft:update-failed',failed);},[onUpdating]);
  async function prepare(kind:UpdateKind,text='',featureId?:string){
    setError('');setNotice('');setSubmitting(true);
    try{await api('/api/updates/request',{kind,request:text,featureId});await refresh();}
    catch{setError('Draft couldn’t start this update. Finish or cancel your current update, then try again.');}
    finally{setSubmitting(false);}
  }
  async function queue(input:object,clear=false){
    setError('');setSubmitting(true);
    try{setData(await api<FeaturesState>('/api/features/queue',input));if(clear)setRequest('');}
    catch(e){setError(e instanceof Error?e.message:'Draft couldn’t change your list. Try again.');}
    finally{setSubmitting(false);}
  }
  async function apply(update:Update){
    setApplying(true);onUpdating(true);setError('');
    try{if(!await onBeforeApply())throw Error('save');const result=await api('/api/updates/apply',{id:update.id,restart:true});if(!result.restart)restartApp();}
    catch(e){setError(e instanceof Error&&e.message==='save'?'Your writing couldn’t be saved. Try saving again before updating.':'Draft couldn’t apply this update. Try again in a moment.');setApplying(false);onUpdating(false);}
  }
  async function discard(update:Update){try{await api('/api/updates/discard',{id:update.id});await refresh();}catch{setError('Draft couldn’t stop this update. Try again.');}}
  async function reconnect(update:Update){
    setError('');setNotice('');setSubmitting(true);setReconnecting(update.id);
    try{const result=await api<{message:string}>('/api/updates/reconnect',{id:update.id});if(mounted.current)setNotice(result.message);}
    catch(error){if(mounted.current)setError(error instanceof Error?error.message:'Sign-in didn’t finish. Your feature is still in your list.');}
    finally{if(mounted.current){setSubmitting(false);setReconnecting('');void refresh();}}
  }
  async function checkOfficial(){
    setError('');setSubmitting(true);
    try{const result=await api('/api/updates/check',{});setNotice(result.message);await refresh();}
    catch{setError('Draft couldn’t look for updates. Try again in a moment.');}finally{setSubmitting(false);}
  }
  async function checkChanges(id:string){
    setError('');setSubmitting(true);
    try{await api('/api/updates/handoff/check',{id});await refresh();return true;}
    catch{setError('Draft couldn’t bring these changes back yet. Finish your other update, or copy a fresh prompt if your app has changed. Your work has been kept.');return false;}
    finally{setSubmitting(false);}
  }
  function openHandoff(target:HandoffTarget){handoffTrigger.current=document.activeElement as HTMLElement;setHandoffTarget(target);}
  function closeHandoff(){setHandoffTarget(undefined);requestAnimationFrame(()=>handoffTrigger.current?.focus());}
  const activeUpdate=data?.updates.find(u=>busy(u)||['ready','needs-attention'].includes(u.state));
  const systemUpdate=activeUpdate&&['official','rollback'].includes(activeUpdate.kind)?activeUpdate:undefined;
  const pending=systemUpdate?undefined:activeUpdate;
  const failedOfficial=!activeUpdate?data?.updates.find(u=>u.kind==='official'&&u.state==='failed'&&u.baseVersion===data.activeVersion):undefined;
  const failedUpdate=!activeUpdate&&data?.updates[0]?.state==='failed'&&!data.updates[0].reconnectedAt&&data.updates[0].kind!=='official'&&data.updates[0].baseVersion===data.activeVersion?data.updates[0]:undefined;
  const changes=data?.current.features.filter(f=>f.origin==='personal'||f.state==='removed'||(()=>{const base=data.official.features.find(x=>x.id===f.id);return !base||f.updatedAt!==base.updatedAt||f.description!==base.description;})())??[];
  const blocked=!!activeUpdate||submitting||applying,ideas=data?.featureQueue??[],selected=ideas.filter(q=>q.selected).length;
  const locked=new Set(pending?.requests?.map(r=>r.id)),handoff=data?.handoffs?.findLast(handoff=>!data.updates.some(update=>update.id===handoff.updateId&&update.reconnectProvider));
  function featureRow(feature:Feature,personal=false){return <div className="feature-row" key={feature.id}>
    <div className="feature-row-main"><strong>{feature.title}</strong>{personal&&<span className="feature-badge">{feature.state==='removed'?'Removed':feature.origin==='personal'?'Added':'Changed'}</span>}</div>
    <p>{feature.description}</p>
    <div className="feature-meta"><time dateTime={feature.updatedAt} title={date(feature.updatedAt,true)}>{date(feature.updatedAt,personal)}</time>
      {feature.state==='active'&&<Button variant="ghost" size="icon-xs" aria-label={`Remove ${feature.title}`} title="Add removal to your list" disabled={submitting||applying||data?.current.features.find(f=>f.id===feature.id)?.state==='removed'||ideas.some(q=>q.kind==='remove'&&q.featureId===feature.id)} onClick={()=>void queue({action:'add',kind:'remove',request:`Remove ${feature.title} from my version of Draft.`,featureId:feature.id})}><Trash2 size={12}/></Button>}
      {feature.state==='removed'&&<Button variant="ghost" size="xs" disabled={submitting||applying} onClick={()=>void queue({action:'add',request:`Restore the feature ${feature.title}. Reuse its stable feature identity ${feature.id}.`})}><RotateCcw size={11}/>Restore</Button>}
    </div>
    {personal&&!data?.demo&&<Button variant="ghost" size="xs" className="feature-more" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({featureId:feature.id})}>Keep working on this</Button>}
  </div>;}
  const sectionText:Record<SectionId,{title:string;detail:string;meta?:string}>={
    customize:{title:'Make it yours',detail:'Ask for any feature and Draft builds it into your own app.',meta:`${ideas.length} ${ideas.length===1?'idea':'ideas'}`},
    changes:{title:'Your changes',detail:changes.length?'What your Draft does differently from official Draft.':'You’re using official Draft.',meta:`${changes.length}`},
    official:{title:'Official features',detail:'Everything Draft does out of the box.',meta:`${data?.official.features.length??0}`},
    updates:{title:'Updates',detail:systemUpdate||data?.latestOfficial?'A new version of Draft is available.':'New versions of Draft and your update history.',meta:data?`Draft ${data.appVersion}`:undefined},
    appearance:{title:'Appearance',detail:'Light, dark, or system.',meta:{light:'Light',dark:'Dark',system:'System'}[savedAppearance()]},
    mac:{title:'Mac',detail:'Open at login and the menu bar icon.'},
    shortcuts:{title:'Shortcuts',detail:'Every keyboard shortcut in Draft.'},
    ai:{title:'AI',detail:'The model that writes titles, summaries and your features.'},
    files:{title:'Files',detail:'Your documents and Draft’s source code.'},
  };
  // The demo on the website has no Mac, no model and no files to show.
  const sections=SECTIONS.filter(id=>!data?.demo||!['mac','ai','files'].includes(id)),shown=open.filter(id=>sections.includes(id)).length?open.filter(id=>sections.includes(id)):['customize' as SectionId];
  const messages=<>{(error||loadError)&&<div className="inline-error" role="alert">{error||loadError}</div>}{notice&&<p className="feature-notice" role="status">{notice}</p>}</>;
  function body(id:SectionId){switch(id){
    case 'customize':return <>
      <form className="feature-request" onSubmit={event=>{event.preventDefault();void queue({action:'add',request},true);}}>
        <textarea aria-label="Feature request" placeholder="What would you like Draft to do?" value={request} onChange={event=>setRequest(event.target.value)} disabled={submitting||applying} rows={2}/>
        <div><span>{data?.demo?null:data?.selection?.model==='claude-opus-5-5'?'Claude Opus 5.5':'Uses your connected AI'}</span><Button type="submit" disabled={submitting||applying||!request.trim()}><Plus size={14}/>Add feature</Button></div>
      </form>
      <section className="feature-wishlist" aria-label="Your feature list">
        <header><h2>Your next update</h2><span>{ideas.length} {ideas.length===1?'idea':'ideas'}</span></header>
        {ideas.length?<ul>{ideas.map((idea,index)=><li key={idea.id}>
          <label><input type="checkbox" checked={idea.selected} disabled={locked.has(idea.id)||submitting||applying} onChange={e=>void queue({action:'select',id:idea.id,selected:e.target.checked})}/><span>{idea.request}</span></label>
          <div>{locked.has(idea.id)?<span className="queued-label">In this update</span>:<><Button variant="ghost" size="icon-xs" aria-label={`Move idea ${index+1} up`} disabled={!index||submitting||applying} onClick={()=>void queue({action:'move',id:idea.id,direction:-1})}><ArrowUp size={12}/></Button><Button variant="ghost" size="icon-xs" aria-label={`Remove idea ${index+1}`} disabled={submitting||applying} onClick={()=>void queue({action:'remove',id:idea.id})}><Trash2 size={12}/></Button></>}</div>
        </li>)}</ul>:<p className="wishlist-empty">Add the changes you have in mind.</p>}
        <div className="wishlist-download" role="status"><span>{pending?pending.state==='ready'?'Your update is ready.':'You can keep writing while it downloads.':selected?`${selected} ${selected===1?'change':'changes'} selected`:'Choose what goes into your next update.'}</span>
          <div>{pending&&<Button variant="ghost" size="sm" disabled={applying} onClick={()=>void discard(pending)}>{pending.state==='ready'?'Discard':'Cancel'}</Button>}
            {pending?.state==='ready'?<Button disabled={applying} onClick={()=>void apply(pending)}><RotateCcw size={14}/>{applying?'Restarting…':'Restart to update'}</Button>:pending?<Button disabled><LoaderCircle size={14} className="spin"/>{status(pending)}</Button>:<Button disabled={blocked||!selected||!!failedUpdate?.reconnectProvider} onClick={()=>void prepare('batch')}><Download size={14}/>Download update</Button>}
          </div>
        </div>
        {pending&&canContinue(pending)&&!data?.demo&&<div className="wishlist-handoff"><span>Want to work on this more?</span><Button variant="ghost" size="xs" onClick={()=>openHandoff({updateId:pending.id})}><Copy size={12}/>Get a prompt for your agent</Button></div>}
      </section>
      {failedUpdate&&<div className="handoff-card" role="status"><div><strong>{failedUpdate.reconnectProvider?`${failedUpdate.reconnectProvider==='claude'?'Claude':'Codex'} needs you to sign in again`:'This update needs a little more work.'}</strong><p>{failedUpdate.reconnectProvider?`Your ${failedUpdate.requests&&failedUpdate.requests.length>1?'features are':'feature is'} still in your list. Your writing is safe.`:'Your ideas are still in your list. Your app is unchanged.'}</p></div>{!data?.demo&&(failedUpdate.reconnectProvider?<Button variant="outline" size="sm" disabled={blocked} onClick={()=>void reconnect(failedUpdate)}>{reconnecting===failedUpdate.id?<><LoaderCircle size={14} className="spin"/>Signing in…</>:'Sign in again'}</Button>:canContinue(failedUpdate)&&<Button variant="outline" size="sm" onClick={()=>openHandoff({updateId:failedUpdate.id})}>Get a prompt for your agent</Button>)}</div>}
      {!pending&&data?.updates[0]?.state==='already-exists'&&<p className="feature-notice" role="status">Draft already does this. You’re ready to keep writing.</p>}
      {handoff&&<div className="handoff-card"><div><strong>Working with your agent?</strong><p>Bring the changes back when you’re happy with them.</p></div><div className="handoff-card-actions"><Button variant="ghost" size="sm" onClick={()=>openHandoff({updateId:handoff.updateId})}>Copy prompt</Button><Button variant="outline" size="sm" disabled={submitting||applying||!!pending&&pending.state!=='ready'} onClick={()=>void checkChanges(handoff.id)}>Check my changes</Button></div></div>}
      {messages}
    </>;
    case 'changes':return <section className="feature-column"><header><div><h2>Your changes</h2><span>{changes.length} {changes.length===1?'change':'changes'}</span></div>{!!changes.length&&<Button variant="ghost" size="icon-sm" aria-label="Return to official Draft" title="Return to official Draft" disabled={blocked} onClick={()=>void prepare('reset','Return to official Draft and preserve all document files.')}><RotateCcw size={15}/></Button>}</header>
      {changes.length?changes.map(feature=>featureRow(feature,true)):<div className="features-empty"><Check size={21}/><p>You’re using official Draft.</p><span>Your updates will appear here.</span></div>}
    </section>;
    case 'official':return <section className="feature-column"><header><div><h2>Official Draft</h2><span>{data?.official.features.length??0} features</span></div>{!data?.demo&&<Button variant="ghost" size="icon-sm" aria-label="Check official updates" title="Check for updates" disabled={blocked} onClick={()=>void checkOfficial()}><RefreshCw size={15}/></Button>}</header>
      {data?.official.features.map(feature=>featureRow(feature))}
    </section>;
    case 'updates':return <>
      <div className="settings-intro"><h1>Draft {data?.appVersion??'…'}</h1><p>Official updates keep your own changes.</p></div>
      {data&&<OfficialUpdate data={data} update={systemUpdate??failedOfficial} blocked={blocked} applying={applying} onPrepare={kind=>void prepare(kind)} onApply={update=>void apply(update)} onDiscard={update=>void discard(update)} onRefresh={()=>void refresh()} onSettings={()=>openSection('ai')}/>}
      {!data?.demo&&<div className="settings-actions"><Button variant="outline" size="sm" disabled={blocked} onClick={()=>void checkOfficial()}><RefreshCw size={13}/>Check for updates</Button>{data?.canUndo&&<Button variant="ghost" size="sm" disabled={blocked} onClick={()=>void prepare('rollback')}><RotateCcw size={13}/>Undo last update</Button>}</div>}
      {messages}
      {!!data?.updates.some(u=>!busy(u)&&!['ready','needs-attention'].includes(u.state))&&<section className="update-history" aria-label="Update history"><h2>Update history</h2>
        {data.updates.filter(u=>!busy(u)&&!['ready','needs-attention'].includes(u.state)).map(u=><div className="history-row" key={u.id}>
          <div><strong>{u.title}</strong><span>{status(u)} · {date(u.updatedAt,true)}</span>{u.state==='failed'&&<p>Your app is unchanged. Your ideas are still in your list.</p>}</div>
          {!data.demo&&canContinue(u)&&<Button variant="ghost" size="xs" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({updateId:u.id})}>Keep working on this</Button>}
        </div>)}
      </section>}
    </>;
    case 'appearance':return <AppearanceSetting/>;
    case 'mac':return <MacPreferences/>;
    case 'shortcuts':return <ShortcutList/>;
    case 'ai':return <section className="settings-section"><h2>Your connected AI</h2><p className="settings-detail">Draft uses the AI you connect for titles, summaries and the features you ask for.</p><div className="settings-actions"><Button variant="outline" size="sm" disabled={!!reconnecting} onClick={()=>setSettings(true)}>Model settings</Button></div></section>;
    case 'files':return <section className="settings-section"><h2>Your files</h2><p className="settings-detail">Your writing and your copy of Draft’s source code live on this Mac.</p><div className="settings-actions"><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'documents'})}><Folder size={13}/>Your documents</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'source'})}><Folder size={13}/>Your source code</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/external',{kind:'source'})}>GitHub<ArrowUpRight size={12}/></Button></div></section>;
  }}
  // Settings is laid out like writing: the sidebar lists the sections and each one you open is a
  // column with a glass tab, like a version. The highlighted section is the column you are in.
  return <main className="workspace settings-workspace" aria-label="Settings">
    {sidebar&&<aside className="inbox settings-sidebar" aria-label="Settings sections">
      <div className="inbox-top" data-drag-region/>
      <ul className="inbox-list">{sections.map(id=>{const text=sectionText[id],selected=id===active;return <li key={id} className={selected?'is-active':undefined}>
        <button className={`inbox-row ${selected?'is-active':''}`} aria-current={selected?'true':undefined} data-section={id} onClick={()=>openSection(id)}>
          <span className="inbox-heading"><span className="inbox-title">{text.title}</span>{text.meta&&<span className="inbox-time">{text.meta}</span>}</span>
          <span className="inbox-preview">{text.detail}</span>
        </button>
      </li>;})}</ul>
      {footer&&<div className="inbox-footer">{footer}</div>}
    </aside>}
    <section className="writing-area"><div className={`version-columns ${shown.length>1?'is-split':''}`} ref={columnsRef}>{shown.map(id=>{const text=sectionText[id],selected=id===active;return <section key={id} className={`version-column settings-column ${selected?'is-active':''}`} data-section={id} aria-label={text.title} onMouseDown={()=>setActive(id)}>
      <div className="version-tab" data-drag-region onContextMenu={e=>{e.preventDefault();setMenu({x:e.clientX,y:e.clientY,id});}}>
        <div className="version-tab-pill" role="tab" aria-selected={selected} aria-label={text.title}>
          <span className="version-tab-bubble version-tab-title">{text.title}</span>
          {text.meta&&<><span className="version-tab-neck" aria-hidden="true"/><span className="version-tab-bubble version-tab-meta">{text.meta}</span></>}
        </div>
      </div>
      <div className="version-scroll"><div className="settings-paper">{body(id)}</div></div>
    </section>;})}</div></section>
    {menu&&<ContextMenu x={menu.x} y={menu.y} label={sectionText[menu.id].title} onClose={()=>setMenu(null)} items={[{label:'Close tab',icon:<X size={14}/>,disabled:shown.length<2,title:shown.length<2?'The last open tab stays open.':undefined,onSelect:()=>closeSection(menu.id)}]}/>}
    {settings&&<ModelSettings onClose={()=>{setSettings(false);void refresh();}}/>}
    {handoffTarget&&<FeatureHandoff target={handoffTarget} onClose={closeHandoff} onCreated={()=>void refresh()} onCheck={checkChanges} checking={submitting} canCheck={!blocked||pending?.state==='ready'}/>}
  </main>;
}
