import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Maximize2,Minimize2} from 'lucide-react';
import App from '../../src/App';
import {Button} from '../../src/components/ui/button';
import {configureDemo} from '../../src/client';
import {cleanText,words} from '../../src/model';
import {DemoStore} from './store';
import {Tour} from './tour';
import '../../src/studio-theme.css';
import '../../src/style.css';
import './style.css';

const store=new DemoStore();store.reset();const root=createRoot(document.getElementById('root')!);let key=0;
function Extras(){
  const [,redraw]=useState(0),[focus,setFocus]=useState(false);
  useEffect(()=>store.subscribe(()=>redraw(n=>n+1)),[]);
  useEffect(()=>{document.body.classList.toggle('demo-focus',focus);const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFocus(false);};window.addEventListener('keydown',escape);return()=>{document.body.classList.remove('demo-focus');window.removeEventListener('keydown',escape);};},[focus]);
  const count=document.querySelector('.word-count'),actions=document.querySelector('.top-actions'),draft=store.library.drafts.find(d=>d.id===store.library.active)!;
  return <>{store.hasReadingTime&&count&&createPortal(<span className="demo-reading-time">{Math.max(1,Math.ceil(words(cleanText(draft))/200))} min read</span>,count)}{store.hasFocus&&actions&&createPortal(<Button variant="ghost" size="sm" aria-pressed={focus} onClick={()=>setFocus(!focus)}><Maximize2 size={13}/>Focus</Button>,actions)}{focus&&<Button className="demo-exit-focus" variant="outline" onClick={()=>setFocus(false)}><Minimize2 size={13}/>Exit focus</Button>}</>;
}
function render(){window.draftBoot={library:structuredClone(store.library),version:store.version};root.render(<React.Fragment key={++key}><App/><Extras/></React.Fragment>);}
configureDemo((path,body,signal)=>store.api(path,body,signal),()=>{render();});render();
const tour=new Tour(store,()=>{store.reset();render();});
const send=(value:object)=>window.parent.postMessage({channel:'draft-demo',...value},location.origin);
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.channel!=='draft-demo')return;const command=event.data.command;if(command==='play')tour.play();if(command==='pause')tour.pause();if(command==='replay')tour.replay();if(command==='try')tour.pause();});
for(const event of ['pointerdown','keydown'])document.addEventListener(event,e=>{if(e.isTrusted){tour.pause();send({state:'paused',scene:'Make it yours'});}},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)tour.pause();});
window.addEventListener('draft-demo-scene',event=>send((event as CustomEvent).detail));
send({state:'ready'});
