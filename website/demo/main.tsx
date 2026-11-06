import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal,flushSync} from 'react-dom';
import {EditorView} from '@codemirror/view';
import {DemoStore,TOUR} from './store';
import {proseWords} from '../../src/model';
import {Tour} from './tour';
import '../../src/studio-theme.css';
import '../../src/style.css';
import '../../src/writing.css';
import '../../src/appearance.css';
import '../../src/chrome.css';
import {setAppearance} from '../../src/theme';
import './style.css';

// The real app talks to Draft's local server with fetch; here every request is answered in memory.
const store=new DemoStore();store.reset();
const realFetch=window.fetch.bind(window);
const demoFetch=async(resource:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url;
  // The Mac shell's window, theme and zoom requests have nothing to do on a web page.
  if(url.startsWith('draft-native:'))return new Response('{}',{headers:{'Content-Type':'application/json'}});
  const path=new URL(url,location.href).pathname;
  if(!path.startsWith('/api/'))return realFetch(resource,init);
  try{
    const body=typeof init?.body==='string'?JSON.parse(init.body):undefined;
    return Response.json(await store.api(path,body));
  }catch(error){return Response.json({error:error instanceof Error?error.message:'This works in the Mac app.'},{status:400});}
};
window.fetch=demoFetch as typeof fetch;
// The walkthrough is always the light window it shows on the page, whatever the visitor's Mac uses.
document.documentElement.dataset.platform='mac';setAppearance('light');

// The Mac's window buttons are supplied by the desktop shell in the native app.
const buttons=document.createElement('div');buttons.className='demo-window-buttons';buttons.append(...[0,1,2].map(()=>document.createElement('span')));
document.body.append(buttons);

const {default:App}=await import('../../src/App');
const root=createRoot(document.getElementById('root')!);let key=0;

// The feature the walkthrough builds: the tab you are in shows your words toward a goal, as one
// more glass bubble on the end of the tab.
function WordGoal(){
  const [target,setTarget]=useState<{pill:Element;words:number}|null>(null);
  useEffect(()=>{
    const timer=setInterval(()=>{
      const column=document.querySelector('.version-column.is-active:not(.settings-column)'),pill=column?.querySelector('.version-tab-pill'),editor=column?.querySelector<HTMLElement>('.cm-editor');
      const view=editor&&EditorView.findFromDOM(editor);
      setTarget(pill?{pill,words:proseWords(view?.state.doc.toString()??'')}:null);
    },250);
    return()=>clearInterval(timer);
  },[]);
  return target&&createPortal(<><span className="version-tab-neck" aria-hidden="true"/><span className="version-tab-bubble version-tab-meta demo-goal">{target.words} / {TOUR.goal} words</span></>,target.pill);
}

// A fresh run starts from the same drafts with nothing remembered from the last one; a restart
// after an update keeps everything and only remounts the app, as Draft would.
function render(fresh=true){
  // Unmount the last run first: its pending effects would otherwise save its own sidebar state over this reset.
  flushSync(()=>root.render(null));
  if(fresh){
    setAppearance('light');
    for(const name of ['draft:viewing','draft:expanded','draft:columns','draft:inbox','draft:settings'])localStorage.removeItem(name);
    localStorage.setItem('draft:expanded',JSON.stringify([store.library.active]));
  }
  window.draftBoot={library:structuredClone(store.library),version:store.version};
  root.render(<React.Fragment key={++key}><App/>{store.hasGoal&&<WordGoal/>}</React.Fragment>);
}
render();
// Applying an update restarts Draft; here the app remounts with the new feature instead.
window.addEventListener('draft:restart',event=>{event.preventDefault();setTimeout(()=>render(false),1200);});

const tour=new Tour(()=>{store.reset();render();},()=>store.finishUpdate());
const send=(value:object)=>window.parent.postMessage({channel:'draft-demo',...value},location.origin);
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent||event.data?.channel!=='draft-demo')return;
  const command=event.data.command;
  if(command==='play')tour.play();
  if(command==='pause')tour.pause();
  if(command==='replay')tour.replay();
  if(command==='layout'){tour.replay(event.data.playing===true);send({state:'layout-ready',layoutId:event.data.layoutId});}
  if(command==='hello')send({state:'ready'});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)tour.pause();});
window.addEventListener('draft-demo-scene',event=>send((event as CustomEvent).detail));
window.addEventListener('draft-demo-pointer',event=>send({pointer:(event as CustomEvent).detail}));
send({state:'ready'});
