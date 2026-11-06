import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {Check} from 'lucide-react';

export type MenuItem={label:ReactNode;icon?:ReactNode;onSelect:()=>void;danger?:boolean;disabled?:boolean;checked?:boolean;title?:string;plain?:boolean}|'divider'|{heading:string};
type Props={x:number;y:number;label:string;items:MenuItem[];onClose:()=>void;className?:string};

// A right-click menu that stays on screen and closes on Escape or a click elsewhere.
export function ContextMenu({x,y,label,items,onClose,className}:Props){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const menu=ref.current!;
    const place=()=>{const {width,height}=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,x+width>innerWidth-8?x-width:x)}px`;menu.style.top=`${Math.max(8,y+height>innerHeight-8?y-height:y)}px`;};
    place();const observer=new ResizeObserver(place);observer.observe(menu);return()=>observer.disconnect();
  },[x,y]);
  useEffect(()=>{
    const menu=ref.current!;menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const pointer=(e:PointerEvent)=>{if(!menu.contains(e.target as Node))onClose();};
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();return;}
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      e.preventDefault();const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
    };
    const close=()=>onClose();
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);window.addEventListener('blur',close);window.addEventListener('resize',close);
    return()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);window.removeEventListener('blur',close);window.removeEventListener('resize',close);};
  },[]);
  return <div className={`context-menu ${className??''}`} ref={ref} role="menu" aria-label={label} style={{left:x,top:y}} onContextMenu={e=>e.preventDefault()}>
    {items.map((item,i)=>item==='divider'?<div key={i} className="menu-divider" role="separator"/>:'heading' in item?<div key={i} className="context-menu-heading">{item.heading}</div>:
      <button key={i} type="button" role={item.checked===undefined?'menuitem':'menuitemcheckbox'} aria-checked={item.checked} title={item.title} disabled={item.disabled} className={item.danger?'is-danger':''} onClick={()=>{onClose();item.onSelect();}}>
        {item.plain?item.label:<><span className="context-menu-icon">{item.checked?<Check size={14}/>:item.icon}</span><span className="context-menu-label">{item.label}</span></>}
      </button>)}
  </div>;
}
