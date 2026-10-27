import {useEffect,useState,useRef} from 'react';
import {ArrowLeft,ArrowUpRight,ArrowUp,Plus,Download,RefreshCw,RotateCcw,Folder,Check,LoaderCircle,Trash2,Copy} from 'lucide-react';
import {Button} from './components/ui/button';
import {api,restartApp} from './client';
import {ModelSettings} from './ModelSettings';
import {FeatureHandoff,type HandoffTarget} from './FeatureHandoff';
import {OfficialUpdate} from './OfficialUpdate';
import {timeRemaining} from '../desktop/feature-queue';
import type {FeaturesState,Feature,Update,UpdateKind} from '../desktop/types';

const date=(value:string,time=false)=>new Date(value).toLocaleString(undefined,time?{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',year:'numeric'});
const busy=(u:Update)=>['checking','preparing','building','applying'].includes(u.state);
const canContinue=(u:Update)=>['add','remove','batch'].includes(u.kind)&&!busy(u);
function status(u:Update){
  switch(u.state){
    case 'checking':case 'preparing':case 'building':return timeRemaining(u);
    case 'ready':return 'Ready when you are.';
    case 'applying':return 'Restarting Draft…';
    case 'applied':return u.kind==='reset'?'Back to official Draft':'Your app is up to date';
    case 'failed':return 'This update needs a little more work.';
    case 'needs-attention':return 'A few choices for your update.';
    case 'cancelled':return 'Update cancelled';
    case 'already-exists':return 'Draft already does this.';
  }
}
export function Features({onBack,onBeforeApply,onUpdating}:{onBack:()=>void;onBeforeApply:()=>Promise<boolean>;onUpdating:(value:boolean)=>void}){
  const [data,setData]=useState<FeaturesState>(),[request,setRequest]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[settings,setSettings]=useState(false),[submitting,setSubmitting]=useState(false),[applying,setApplying]=useState(false);
  const [handoffTarget,setHandoffTarget]=useState<HandoffTarget>();
  const mounted=useRef(true),handoffTrigger=useRef<HTMLElement|null>(null);
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
  const changes=data?.current.features.filter(f=>f.origin==='personal'||f.state==='removed'||(()=>{const base=data.official.features.find(x=>x.id===f.id);return !base||f.updatedAt!==base.updatedAt||f.description!==base.description;})())??[];
  const blocked=!!activeUpdate||submitting||applying,ideas=data?.featureQueue??[],selected=ideas.filter(q=>q.selected).length;
  const locked=new Set(pending?.requests?.map(r=>r.id)),handoff=data?.handoffs?.at(-1);
  function featureRow(feature:Feature,personal=false){return <div className="feature-row" key={feature.id}>
    <div className="feature-row-main"><strong>{feature.title}</strong>{personal&&<span className="feature-badge">{feature.state==='removed'?'Removed':feature.origin==='personal'?'Added':'Changed'}</span>}</div>
    <p>{feature.description}</p>
    <div className="feature-meta"><time dateTime={feature.updatedAt} title={date(feature.updatedAt,true)}>{date(feature.updatedAt,personal)}</time>
      {feature.state==='active'&&<Button variant="ghost" size="icon-xs" aria-label={`Remove ${feature.title}`} title="Add removal to your list" disabled={submitting||applying||data?.current.features.find(f=>f.id===feature.id)?.state==='removed'||ideas.some(q=>q.kind==='remove'&&q.featureId===feature.id)} onClick={()=>void queue({action:'add',kind:'remove',request:`Remove ${feature.title} from my version of Draft.`,featureId:feature.id})}><Trash2 size={12}/></Button>}
      {feature.state==='removed'&&<Button variant="ghost" size="xs" disabled={submitting||applying} onClick={()=>void queue({action:'add',request:`Restore the feature ${feature.title}. Reuse its stable feature identity ${feature.id}.`})}><RotateCcw size={11}/>Restore</Button>}
    </div>
    {personal&&!data?.demo&&<Button variant="ghost" size="xs" className="feature-more" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({featureId:feature.id})}>Keep working on this</Button>}
  </div>;}
  return <section className="features-page">
    <div className="features-top"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14}/>Writing</Button>{!data?.demo&&<Button variant="outline" size="sm" onClick={()=>setSettings(true)}>Model settings</Button>}</div>
    <div className="features-heading"><div><h1>Make Draft yours.</h1><p>Keep a list. Update when you’re ready.</p></div><span className="version-label">Draft {data?.appVersion??'…'}</span></div>
    {data&&!data.demo&&<OfficialUpdate data={data} update={systemUpdate??failedOfficial} blocked={blocked} applying={applying} onPrepare={kind=>void prepare(kind)} onApply={update=>void apply(update)} onDiscard={update=>void discard(update)} onRefresh={()=>void refresh()} onSettings={()=>setSettings(true)}/>}
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
          {pending?.state==='ready'?<Button disabled={applying} onClick={()=>void apply(pending)}><RotateCcw size={14}/>{applying?'Restarting…':'Restart to update'}</Button>:pending?<Button disabled><LoaderCircle size={14} className="spin"/>{status(pending)}</Button>:<Button disabled={blocked||!selected} onClick={()=>void prepare('batch')}><Download size={14}/>Download update</Button>}
        </div>
      </div>
      {pending&&canContinue(pending)&&!data?.demo&&<div className="wishlist-handoff"><span>Want to work on this more?</span><Button variant="ghost" size="xs" onClick={()=>openHandoff({updateId:pending.id})}><Copy size={12}/>Get a prompt for your agent</Button></div>}
    </section>
    {!activeUpdate&&data?.updates[0]?.state==='failed'&&data.updates[0].kind!=='official'&&data.updates[0].baseVersion===data.activeVersion&&<div className="handoff-card" role="status"><div><strong>This update needs a little more work.</strong><p>Your ideas are still in your list. Your app is unchanged.</p></div>{!data.demo&&canContinue(data.updates[0])&&<Button variant="outline" size="sm" onClick={()=>openHandoff({updateId:data.updates[0].id})}>Get a prompt for your agent</Button>}</div>}
    {!pending&&data?.updates[0]?.state==='already-exists'&&<p className="feature-notice" role="status">Draft already does this. You’re ready to keep writing.</p>}
    {handoff&&<div className="handoff-card"><div><strong>Working with your agent?</strong><p>Bring the changes back when you’re happy with them.</p></div><div className="handoff-card-actions"><Button variant="ghost" size="sm" onClick={()=>openHandoff({updateId:handoff.updateId})}>Copy prompt</Button><Button variant="outline" size="sm" disabled={submitting||applying||!!pending&&pending.state!=='ready'} onClick={()=>void checkChanges(handoff.id)}>Check my changes</Button></div></div>}
    {(error||loadError)&&<div className="inline-error" role="alert">{error||loadError}</div>}{notice&&<p className="feature-notice" role="status">{notice}</p>}
    <div className="features-columns">
      <section className="feature-column"><header><div><h2>Official Draft</h2><span>{data?.official.features.length??0} features</span></div>{!data?.demo&&<Button variant="ghost" size="icon-sm" aria-label="Check official updates" title="Check for updates" disabled={blocked} onClick={()=>void checkOfficial()}><RefreshCw size={15}/></Button>}</header>
        {data?.official.features.map(feature=>featureRow(feature))}
      </section>
      <section className="feature-column"><header><div><h2>Your changes</h2><span>{changes.length} {changes.length===1?'change':'changes'}</span></div>{!!changes.length&&<Button variant="ghost" size="icon-sm" aria-label="Return to official Draft" title="Return to official Draft" disabled={blocked} onClick={()=>void prepare('reset','Return to official Draft and preserve all document files.')}><RotateCcw size={15}/></Button>}</header>
        {changes.length?changes.map(feature=>featureRow(feature,true)):<div className="features-empty"><Check size={21}/><p>You’re using official Draft.</p><span>Your updates will appear here.</span></div>}
      </section>
    </div>
    {!data?.demo&&<div className="features-footer"><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'source'})}><Folder size={13}/>Your source code</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'documents'})}><Folder size={13}/>Your documents</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/external',{kind:'source'})}>GitHub<ArrowUpRight size={12}/></Button>{data?.canUndo&&<Button variant="ghost" size="sm" disabled={blocked} onClick={()=>void prepare('rollback')}><RotateCcw size={13}/>Undo last update</Button>}</div>}
    {!!data?.updates.some(u=>!busy(u)&&!['ready','needs-attention'].includes(u.state))&&<details className="update-history"><summary>Update history</summary>
      {data.updates.filter(u=>!busy(u)&&!['ready','needs-attention'].includes(u.state)).map(u=><div className="history-row" key={u.id}>
        <div><strong>{u.title}</strong><span>{status(u)} · {date(u.updatedAt,true)}</span>{u.state==='failed'&&<p>Your app is unchanged. Your ideas are still in your list.</p>}</div>
        {!data.demo&&canContinue(u)&&<Button variant="ghost" size="xs" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({updateId:u.id})}>Keep working on this</Button>}
      </div>)}
    </details>}
    {settings&&<ModelSettings onClose={()=>{setSettings(false);void refresh();}}/>}
    {handoffTarget&&<FeatureHandoff target={handoffTarget} onClose={closeHandoff} onCreated={()=>void refresh()} onCheck={checkChanges} checking={submitting} canCheck={!blocked||pending?.state==='ready'}/>}
  </section>;
}
