import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {Check,Copy,LoaderCircle,X} from 'lucide-react';
import {Button} from './components/ui/button';
import {api} from './client';
import type {HandoffPrompt} from '../desktop/types';

export type HandoffTarget={updateId?:string;featureId?:string};
export function FeatureHandoff({target,onClose,onCreated,onCheck,checking,canCheck}:{target:HandoffTarget;onClose:()=>void;onCreated:(id:string)=>void;onCheck:(id:string)=>Promise<boolean>;checking:boolean;canCheck:boolean}){
  const [handoff,setHandoff]=useState<HandoffPrompt>(),[error,setError]=useState(''),[copied,setCopied]=useState(false),[showPrompt,setShowPrompt]=useState(false);
  const field=useRef<HTMLTextAreaElement>(null),copyButton=useRef<HTMLButtonElement>(null);
  const created=useRef(onCreated);created.current=onCreated;
  useEffect(()=>{
    const abort=new AbortController();
    void api<HandoffPrompt>('/api/updates/handoff',target,abort.signal).then(value=>{setHandoff(value);created.current(value.id);requestAnimationFrame(()=>copyButton.current?.focus());}).catch(()=>{if(!abort.signal.aborted)setError('Draft couldn’t make the prompt. Close this window and try again.');});
    return()=>abort.abort();
  },[target]);
  async function copy(){
    if(!handoff)return;
    try{await navigator.clipboard.writeText(handoff.prompt);setCopied(true);setError('');}
    catch{
      setShowPrompt(true);requestAnimationFrame(()=>{field.current?.focus();field.current?.select();if(document.execCommand('copy')){setCopied(true);setError('');}else setError('Select the prompt below and press ⌘C to copy it.');});
    }
  }
  function keyboard(event:KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){event.stopPropagation();onClose();return;}
    if(event.key==='Tab'){
      const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, summary')].filter(node=>node.getClientRects().length);
      const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="modal handoff-dialog" role="dialog" aria-modal="true" aria-label="Keep working on this feature" onKeyDown={keyboard}>
      <Button variant="ghost" size="icon-sm" className="modal-close" aria-label="Close feature prompt" onClick={onClose}><X size={17}/></Button>
      <h2>Make it just right.</h2>
      <p>Paste this prompt into Claude Code or Codex, then tell it what you’d like to change.</p>
      <ol className="handoff-steps"><li>Copy the prompt and give it to your agent.</li><li>Work together until you’re happy with the feature.</li><li>Come back here to check and apply your changes.</li></ol>
      {!handoff&&!error&&<p className="discovery-status" role="status"><LoaderCircle size={15} className="spin"/>Getting your prompt ready…</p>}
      {handoff&&<>
        <Button ref={copyButton} className="handoff-copy" aria-label={copied?'Prompt copied':'Copy prompt'} onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}<span role="status">{copied?'Prompt copied':'Copy prompt'}</span></Button>
        <p className="modal-small">It includes your request, progress, and a separate copy of the feature. Your writing stays in Draft.</p>
        <details className="handoff-preview" open={showPrompt} onToggle={event=>setShowPrompt(event.currentTarget.open)}><summary>See the prompt</summary><textarea ref={field} aria-label="Feature prompt" value={handoff.prompt} readOnly rows={10}/></details>
        <div className="handoff-return"><div><strong>Ready to bring it back?</strong><p>Draft will check the changes before you update.</p></div><Button variant="outline" disabled={checking||!canCheck} onClick={()=>void onCheck(handoff.id).then(ok=>{if(ok)onClose();})}>{checking?'Checking…':'Check my changes'}</Button></div>
      </>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
    </section>
  </div>;
}
