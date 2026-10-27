import {useEffect,useState} from 'react';
import {Check,Download,LoaderCircle,RotateCcw} from 'lucide-react';
import {Button} from './components/ui/button';
import {api} from './client';
import type {FeaturesState,Update,UpdateKind} from '../desktop/types';
import type {ConflictChoice} from '../desktop/official-merge';

export function OfficialUpdate({data,update,blocked,applying,onPrepare,onApply,onDiscard,onRefresh,onSettings}:{data:FeaturesState;update?:Update;blocked:boolean;applying:boolean;onPrepare:(kind:UpdateKind)=>void;onApply:(update:Update)=>void;onDiscard:(update:Update)=>void;onRefresh:()=>void;onSettings:()=>void}){
 const [choices,setChoices]=useState<Record<string,ConflictChoice>>({}),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setChoices(update?.official?.choices??{});setError('');},[update?.id]);
 const needsChoices=update?.state==='needs-attention',ready=update?.state==='ready',failed=update?.state==='failed';
 const conflicts=update?.official?.conflicts??[],working=update&&['checking','preparing','building','applying'].includes(update.state);
 const retained=update?.official?.expected?.preserved.map(id=>data.current.features.find(feature=>feature.id===id)).filter(Boolean)??[];
 if(!update&&!data.latestOfficial)return null;
 async function resolve(){if(!update)return;setError('');setSubmitting(true);try{await api('/api/updates/resolve',{id:update.id,choices:Object.fromEntries(conflicts.map(conflict=>[conflict.id,choices[conflict.id]??'keep-mine']))});onRefresh();}catch{setError('Draft couldn’t start combining these choices. Try again in a moment.');}finally{setSubmitting(false);}}
 const percent=update?.download?Math.min(100,Math.floor(update.download.received/update.download.total*100)):undefined;
 return <section className="official-update-card" aria-label="Draft update">
  <div className="official-update-heading"><div><h2>{update?.kind==='rollback'?'Go back to your previous app.':needsChoices?'A few choices for your update.':ready?'Your update is ready.':'New from Draft.'}</h2><p>{needsChoices?'Choose how you’d like these parts of your app to work.':update?.kind==='rollback'?'Your writing stays as it is.':ready?'Your changes are included. Restart when you’re ready.':'Get the latest improvements and keep what makes your app yours.'}</p></div>{ready&&<Check size={19}/>}</div>
  {!needsChoices&&data.latestOfficial?.notes?.length&&<ul className="official-update-notes">{data.latestOfficial.notes.slice(0,4).map(note=><li key={note}>{note}</li>)}</ul>}
  {needsChoices&&<div className="update-conflicts">{conflicts.map(conflict=><fieldset key={conflict.id}><legend>{conflict.title}</legend><p>{conflict.description}</p><div className="conflict-choices">{([['keep-mine','Keep mine','Keep how this works in your app.'],['use-official','Use Draft’s','Replace this change with the official version.'],['combine','Combine both','Ask your model to bring both together.']] as const).map(([value,label,description])=><label key={value}><input type="radio" name={`conflict-${conflict.id}`} value={value} checked={(choices[conflict.id]??'keep-mine')===value} disabled={submitting||applying} onChange={()=>setChoices(previous=>({...previous,[conflict.id]:value}))}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div></fieldset>)}
   {update.official?.needsModel&&<p className="update-help">Connect a model to keep these changes together, or choose Draft’s version.</p>}
   {update.error&&<p className="update-help">Draft couldn’t combine these choices yet. Try another option, or keep writing with your current app.</p>}
  </div>}
  {retained.length>0&&ready&&<p className="update-kept">Keeping {retained.slice(0,4).map(feature=>feature!.title+(feature!.state==='removed'?' (off)':'')).join(', ')}{retained.length>4?`, and ${retained.length-4} more`:''}.</p>}
  {failed&&<p className="update-help">The update couldn’t finish. Your current app and writing are safe.</p>}
  {(working||applying)&&<div className="official-update-progress" role="status"><LoaderCircle size={15} className="spin"/><span>{applying?'Restarting Draft…':percent!==undefined&&percent<100?`Downloading… ${percent}%`:'Putting your update together…'}</span></div>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="official-update-actions">
   {update&&!failed&&<Button variant="ghost" disabled={applying||submitting} onClick={()=>onDiscard(update)}>{ready?'Discard':'Cancel'}</Button>}
   {needsChoices&&<><Button variant="outline" disabled={submitting||applying} onClick={onSettings}>Model settings</Button><Button disabled={submitting||applying} onClick={()=>void resolve()}>{submitting?<LoaderCircle size={14} className="spin"/>:null}Continue update</Button></>}
   {ready&&<Button disabled={applying} onClick={()=>onApply(update)}><RotateCcw size={14}/>Restart to update</Button>}
   {(!update||failed)&&<Button disabled={blocked||applying} onClick={()=>onPrepare('official')}><Download size={14}/>{failed?'Try again':'Download update'}</Button>}
  </div>
 </section>;
}
