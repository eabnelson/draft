import {useEffect,useState,useRef} from 'react';
import {ArrowLeft,ArrowUpRight,Plus,Download,RefreshCw,RotateCcw,Folder,Check,LoaderCircle,Trash2,Copy} from 'lucide-react';
import {Button} from './components/ui/button';
import {api} from './client';
import {ModelSettings} from './ModelSettings';
import {FeatureHandoff,type HandoffTarget} from './FeatureHandoff';
import type {FeaturesState,Feature,Update,UpdateKind} from '../desktop/types';

const date=(value:string,time=false)=>new Date(value).toLocaleString(undefined,time?{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',year:'numeric'});
const busy=(update:Update)=>['checking','preparing','building','applying'].includes(update.state);
const canContinue=(update:Update)=>['add','remove'].includes(update.kind)&&!busy(update);
function status(update:Update){
  switch(update.state){
    case 'checking':return 'Looking at your request…';
    case 'preparing':return 'Creating your update…';
    case 'building':return 'Making sure everything works…';
    case 'ready':return 'Your update is ready.';
    case 'applying':return 'Updating Draft…';
    case 'applied':return update.kind==='reset'?'Back to official Draft':update.kind==='remove'?'Feature removed':'Update added to Draft';
    case 'failed':return 'This update needs a little more work.';
    case 'cancelled':return 'Update cancelled';
    case 'already-exists':return 'Draft already does this.';
  }
}
export function Features({onBack,onBeforeApply}:{onBack:()=>void;onBeforeApply:()=>Promise<boolean>}){
  const [data,setData]=useState<FeaturesState>(),[request,setRequest]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[settings,setSettings]=useState(false),[submitting,setSubmitting]=useState(false),[applying,setApplying]=useState(false);
  const [handoffTarget,setHandoffTarget]=useState<HandoffTarget>(),[selectedHandoff,setSelectedHandoff]=useState<string>();
  const mounted=useRef(true),handoffTrigger=useRef<HTMLElement|null>(null);
  async function refresh(){try{const value=await api<FeaturesState>('/api/features');if(mounted.current){setData(value);setLoadError('');}}catch{if(mounted.current)setLoadError('Draft couldn’t load your features. Try again in a moment.');}}
  useEffect(()=>{mounted.current=true;void refresh();const interval=setInterval(()=>void refresh(),1500);return()=>{mounted.current=false;clearInterval(interval);};},[]);
  async function prepare(kind:UpdateKind,text='',featureId?:string){
    setError('');setNotice('');setSubmitting(true);
    try{await api('/api/updates/request',{kind,request:text,featureId});setRequest('');await refresh();}
    catch{setError('Draft couldn’t start this update. Finish or cancel your current update, then try again.');}
    finally{setSubmitting(false);}
  }
  async function apply(update:Update){
    setApplying(true);setError('');
    try{if(!await onBeforeApply()){setError('Your writing couldn’t be saved. Try saving again before updating.');setApplying(false);return;}await api('/api/updates/apply',{id:update.id});window.location.reload();}
    catch{setError('Draft couldn’t apply this update. Your current app is unchanged.');setApplying(false);}
  }
  async function discard(update:Update){try{await api('/api/updates/discard',{id:update.id});await refresh();}catch{setError('Draft couldn’t stop this update. Try again.');}}
  async function checkOfficial(){
    setError('');setSubmitting(true);
    try{const result=await api('/api/updates/check',{});setNotice(result.available?'A new Draft update is available.':'You’re up to date.');await refresh();}
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
  const pending=data?.updates.find(u=>busy(u)||u.state==='ready');
  const changes=data?.current.features.filter(f=>f.origin==='personal'||f.state==='removed'||(()=>{const base=data.official.features.find(x=>x.id===f.id);return !base||f.updatedAt!==base.updatedAt||f.description!==base.description;})())??[];
  const blocked=!!pending||submitting||applying;
  const handoff=data?.handoffs?.find(h=>h.id===selectedHandoff)??data?.handoffs?.at(-1);
  const canCheck=!submitting&&!applying&&(!pending||pending.state==='ready');
  function featureRow(feature:Feature,personal=false){return <div className="feature-row" key={feature.id}>
    <div className="feature-row-main"><strong>{feature.title}</strong>{personal&&<span className="feature-badge">{feature.state==='removed'?'Removed':feature.origin==='personal'?'Added':'Changed'}</span>}</div>
    <p>{feature.description}</p>
    <div className="feature-meta"><time dateTime={feature.updatedAt} title={date(feature.updatedAt,true)}>{date(feature.updatedAt,personal)}</time>
      {feature.state==='active'&&<Button variant="ghost" size="icon-xs" aria-label={`Remove ${feature.title}`} disabled={blocked||(!personal&&data?.current.features.find(f=>f.id===feature.id)?.state==='removed')} onClick={()=>void prepare('remove',`Remove ${feature.title} from my version of Draft.`,feature.id)}><Trash2 size={12}/></Button>}
      {feature.state==='removed'&&<Button variant="ghost" size="xs" disabled={blocked} onClick={()=>void prepare('add',`Restore the feature ${feature.title}. Reuse its stable feature identity ${feature.id}.`)}><RotateCcw size={11}/>Restore</Button>}
    </div>
    {personal&&<Button variant="ghost" size="xs" className="feature-more" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({featureId:feature.id})}>Keep working on this</Button>}
  </div>;}
  return <section className="features-page">
    <div className="features-top"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14}/>Writing</Button><Button variant="outline" size="sm" onClick={()=>setSettings(true)}>Model settings</Button></div>
    <div className="features-heading"><div><h1>Make Draft yours.</h1><p>Your writing app, with the features you want.</p></div><span className="version-label">Draft {data?.appVersion??'…'}</span></div>
    <form className="feature-request" onSubmit={event=>{event.preventDefault();void prepare('add',request);}}>
      <textarea aria-label="Feature request" placeholder="What would you like Draft to do?" value={request} onChange={event=>setRequest(event.target.value)} disabled={blocked} rows={3}/>
      <div><span>{data?.selection?data.selection.model==='claude-opus-5-5'?'Claude Opus 5.5':`${data.selection.provider==='claude'?'Claude':'Codex'} · ${data.selection.model}`:'Uses your connected AI'}</span><Button type="submit" disabled={blocked||!request.trim()}><Plus size={14}/>Create update</Button></div>
    </form>
    {pending&&<div className="update-card" role="status">
      <div className="update-icon">{pending.state==='ready'?<Download size={20}/>:<LoaderCircle size={20} className="spin"/>}</div>
      <div className="update-content"><strong>{pending.title}</strong><span>{status(pending)}</span>{pending.state==='ready'&&<p>Your app stays as it is until you choose Update app.</p>}
        {canContinue(pending)&&<div className="keep-working"><p>Want to keep working on this feature?</p><Button variant="ghost" size="xs" onClick={()=>openHandoff({updateId:pending.id})}><Copy size={12}/>Get a prompt for your agent</Button></div>}
      </div>
      <div className="update-buttons">{pending.state==='ready'&&<Button disabled={applying} onClick={()=>void apply(pending)}><Download size={14}/>{applying?'Updating…':'Update app'}</Button>}<Button variant="ghost" size="sm" disabled={applying} onClick={()=>void discard(pending)}>{pending.state==='ready'?'Discard':'Cancel'}</Button></div>
    </div>}
    {handoff&&<div className="handoff-card"><div><strong>Working with your agent?</strong><p>Bring the changes back when you’re happy with them.</p></div><div className="handoff-card-actions"><Button variant="ghost" size="sm" onClick={()=>openHandoff({updateId:handoff.updateId})}>Copy prompt</Button><Button variant="outline" size="sm" disabled={!canCheck} onClick={()=>void checkChanges(handoff.id)}>{submitting?'Checking…':'Check my changes'}</Button></div></div>}
    {(error||loadError)&&<div className="inline-error" role="alert">{error||loadError}</div>}{notice&&<p className="feature-notice" role="status">{notice}</p>}
    <div className="features-columns">
      <section className="feature-column"><header><div><h2>Official Draft</h2><span>{data?.official.features.length??0} features</span></div><Button variant="ghost" size="icon-sm" aria-label="Check official updates" title="Check for updates" disabled={blocked} onClick={()=>void checkOfficial()}><RefreshCw size={15}/></Button></header>
        {data?.latestOfficial&&<div className="official-available"><span>A new update is available.</span><Button variant="outline" size="xs" disabled={blocked} onClick={()=>void prepare('official','Update official Draft and preserve my personal changes.')}>Get update</Button></div>}
        {data?.official.features.map(feature=>featureRow(feature))}
      </section>
      <section className="feature-column"><header><div><h2>Your changes</h2><span>{changes.length} {changes.length===1?'change':'changes'}</span></div>{!!changes.length&&<Button variant="ghost" size="icon-sm" aria-label="Return to official Draft" title="Return to official Draft" disabled={blocked} onClick={()=>void prepare('reset','Return to official Draft and preserve all document files.')}><RotateCcw size={15}/></Button>}</header>
        {changes.length?changes.map(feature=>featureRow(feature,true)):<div className="features-empty"><Check size={21}/><p>You’re using official Draft.</p><span>New features you apply will appear here.</span></div>}
      </section>
    </div>
    <div className="features-footer"><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'source'})}><Folder size={13}/>Your source code</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/reveal',{kind:'documents'})}><Folder size={13}/>Your documents</Button><Button variant="ghost" size="sm" onClick={()=>void api('/api/external',{kind:'source'})}>GitHub<ArrowUpRight size={12}/></Button></div>
    {!!data?.updates.some(update=>!busy(update)&&update.state!=='ready')&&<details className="update-history"><summary>Update history</summary>
      {data.updates.filter(update=>!busy(update)&&update.state!=='ready').map(update=><div className="history-row" key={update.id}>
        <div><strong>{update.title}</strong><span>{status(update)} · {date(update.updatedAt,true)}</span>{update.state==='failed'&&<p>Your current app is unchanged. You can try again or keep working with your agent.</p>}{update.state==='already-exists'&&<p>Try the {data.current.features.find(feature=>feature.id===update.existingFeatureId)?.title??'existing'} feature in Draft.</p>}</div>
        <div className="history-actions">{update.state==='failed'&&<Button variant="outline" size="xs" disabled={blocked} onClick={()=>void (update.handoffId?checkChanges(update.handoffId):prepare(update.kind,update.request,update.featureId))}>{update.handoffId?'Check again':'Try again'}</Button>}{canContinue(update)&&<Button variant="ghost" size="xs" disabled={!!pending&&busy(pending)} onClick={()=>openHandoff({updateId:update.id})}>Keep working on this</Button>}</div>
      </div>)}
    </details>}
    {settings&&<ModelSettings onClose={()=>{setSettings(false);void refresh();}}/>}
    {handoffTarget&&<FeatureHandoff target={handoffTarget} onClose={closeHandoff} onCreated={id=>{setSelectedHandoff(id);void refresh();}} onCheck={checkChanges} checking={submitting} canCheck={canCheck}/>}
  </section>;
}
