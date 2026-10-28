import {useState,useEffect} from 'react';
import {X,RefreshCw,Check,LoaderCircle,ArrowUpRight} from 'lucide-react';
import {Button} from './components/ui/button';
import {api} from './client';
import type {Provider,AgentSelection} from '../desktop/types';

export function ModelSettings({onClose}:{onClose:()=>void}){
  const [providers,setProviders]=useState<Provider[]>([]),[selection,setSelection]=useState<AgentSelection>(),[busy,setBusy]=useState(true),[error,setError]=useState(''),[login,setLogin]=useState('');
  async function refresh(){setBusy(true);setError('');try{const result=await api<{providers:Provider[];selection?:AgentSelection}>('/api/providers?refresh=1');setProviders(result.providers);setSelection(result.selection);}catch(e){setError(String(e));}finally{setBusy(false);}}
  useEffect(()=>{void refresh();},[]);
  async function connect(id:string){setLogin(id);setError('');try{await api('/api/providers/login',{provider:id});await refresh();}catch(e){setError(e instanceof Error?e.message:'Sign-in did not complete.');}finally{setLogin('');}}
  async function choose(value:string){const [provider,...rest]=value.split(':');const next={provider,model:rest.join(':')} as AgentSelection;try{await api('/api/providers/select',next);setSelection(next);}catch(e){setError(String(e));}}
  const selectedAvailable=selection&&providers.some(provider=>provider.ready&&provider.id===selection.provider&&provider.models.some(model=>model.id===selection.model));
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal" role="dialog" aria-modal="true" aria-label="Model settings"><Button variant="ghost" size="icon-sm" className="modal-close" aria-label="Close model settings" onClick={onClose}><X size={17}/></Button><h2>Your model</h2><p>Draft uses the coding agent you’ve already installed and signed in to.</p>
    {busy&&<p className="discovery-status"><LoaderCircle size={15} className="spin"/>Checking your Mac…</p>}
    {providers.map(provider=><div className="provider-row" key={provider.id}><div><strong>{provider.name}</strong><span>{provider.ready?'Connected':provider.installed?'Sign-in needed':'Not installed'}</span></div>{provider.ready&&<Check size={16}/>} {provider.installed?<Button variant={provider.ready?'ghost':'outline'} size="sm" disabled={!!login} onClick={()=>void connect(provider.id)}>{login===provider.id?'Signing in…':provider.ready?'Sign in again':'Sign in'}</Button>:<Button variant="outline" size="sm" onClick={()=>void api('/api/external',{kind:provider.id})}>Install<ArrowUpRight size={13}/></Button>}</div>)}
    {providers.some(p=>p.ready)&&<label className="model-field">Model<select aria-label="Selected model" value={selection?`${selection.provider}:${selection.model}`:''} onChange={e=>void choose(e.target.value)}>{!selection&&<option value="">Choose a model</option>}{selection&&!selectedAvailable&&<option value={`${selection.provider}:${selection.model}`} disabled>Your selected model is unavailable</option>}{providers.filter(p=>p.ready).map(provider=><optgroup key={provider.id} label={provider.name}>{[...new Map(provider.models.map(m=>[m.id,m])).values()].map(m=><option key={m.id} value={`${provider.id}:${m.id}`}>{m.name}</option>)}</optgroup>)}</select></label>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="model-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={13}/>Refresh</Button><Button onClick={onClose}>Done</Button></div>
    <p className="modal-small">AI requests use your existing account and its limits. Writing and saving work without AI.</p>
  </section></div>;
}
