// The installed desktop host owns these controls, independently of personal UI.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Features} from '../src/Features';
import {api} from '../src/client';
import {startGlass} from '../src/glass';
import '../src/studio-theme.css';
import '../src/style.css';
import '../src/writing.css';
import '../src/appearance.css';
import '../src/chrome.css';
function UpdateWindow(){
 const [updating,setUpdating]=useState(false);
 const fill=useRef<HTMLDivElement>(null);
 useEffect(()=>fill.current?startGlass(fill.current):undefined,[]);
 useEffect(()=>{const close=()=>void api('/api/close/ready',{});const failed=()=>setUpdating(false);window.addEventListener('draft:save-and-close',close);window.addEventListener('draft:update-failed',failed);return()=>{window.removeEventListener('draft:save-and-close',close);window.removeEventListener('draft:update-failed',failed);};},[]);
 return <><div className="glass-fill" ref={fill} aria-hidden="true"/><div className="app with-panel"><Features openTo={{id:'updates',at:0}} onBeforeApply={async()=>true} onUpdating={setUpdating}/>{updating&&<div className="restart-overlay" role="status">Restarting Draft…</div>}</div></>;
}
createRoot(document.getElementById('root')!).render(<UpdateWindow/>);
