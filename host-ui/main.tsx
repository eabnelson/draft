// The installed desktop host owns these controls, independently of personal UI.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Features} from '../src/Features';
import {api} from '../src/client';
import '../src/studio-theme.css';
import '../src/style.css';
import '../src/writing.css';
function UpdateWindow(){
 const [updating,setUpdating]=useState(false);
 useEffect(()=>{const close=()=>void api('/api/close/ready',{});const failed=()=>setUpdating(false);window.addEventListener('draft:save-and-close',close);window.addEventListener('draft:update-failed',failed);return()=>{window.removeEventListener('draft:save-and-close',close);window.removeEventListener('draft:update-failed',failed);};},[]);
 return <div className="app"><main className="features-scroll"><Features onBack={()=>location.assign('/')} onBeforeApply={async()=>true} onUpdating={setUpdating}/></main>{updating&&<div className="restart-overlay" role="status">Restarting Draft…</div>}</div>;
}
createRoot(document.getElementById('root')!).render(<UpdateWindow/>);
