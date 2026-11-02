import {useEffect,useRef,useState} from 'react';
import {type Draft,type Version,displayTitle,stage,latest,versionTitle,STAGES} from './model';
import {plainText} from './markdown';

const PLATFORM_NAMES={instagram:'Instagram',tiktok:'TikTok',x:'X',threads:'Threads',youtube:'YouTube'} as const;
export function relativeTime(iso:string,now=Date.now()):string {
  const seconds=Math.max(0,(now-Date.parse(iso))/1000);
  if(seconds<60)return 'Just now';
  if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;
  if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;
  if(seconds<172800)return 'Yesterday';
  const date=new Date(iso);
  return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==new Date(now).getFullYear()?{year:'numeric'}:{})});
}
// The AI summary once it is ready; until then the opening sentences, without repeating the title.
function preview(d:Draft){
  if(d.summary)return d.summary.text;
  const lines=plainText(latest(d).text).split('\n').map(line=>line.trim()).filter(Boolean),title=d.title.replace(/…$/,'').trim().toLowerCase();
  // A title taken from the first sentence is left out whole, even when it was shortened.
  if(title&&lines[0]?.toLowerCase().startsWith(title))for(const part of new Intl.Segmenter('en',{granularity:'sentence'}).segment(lines[0])){lines[0]=lines[0].slice(part.segment.length).trim();break;}
  return lines.filter(Boolean).join(' ').replace(/\s+/g,' ').slice(0,240);
}
// A title that is too long is cut off; hovering scrolls it on a loop so you can read all of it.
export function Marquee({text,className}:{text:string;className:string}){
  const clip=useRef<HTMLSpanElement>(null),[loop,setLoop]=useState<number|null>(null);
  return <span className={className} onMouseEnter={()=>{const el=clip.current;if(el&&el.scrollWidth>el.clientWidth+1)setLoop(el.scrollWidth);}} onMouseLeave={()=>setLoop(null)}>
    <span className="marquee-clip" ref={clip}>{loop===null?text:<span className="marquee" style={{animationDuration:`${Math.max(4,loop/35)}s`}}><span>{text}</span><span aria-hidden="true">{text}</span></span>}</span>
  </span>;
}
export const versionPreview=(v:Version)=>versionTitle(v)||'Untitled';
export const sortedVersions=(d:Draft)=>[...d.versions].sort((a,b)=>a.number-b.number);

// Typing a new name in place: Enter or clicking away keeps it, Escape leaves it as it was.
export function NameField({initial,label,className,onDone}:{initial:string;label:string;className:string;onDone:(name:string|null)=>void}){
  const input=useRef<HTMLInputElement>(null),done=useRef(false);
  useEffect(()=>{input.current?.focus();input.current?.select();},[]);
  const finish=(name:string|null)=>{if(done.current)return;done.current=true;onDone(name);};
  return <input ref={input} className={className} aria-label={label} defaultValue={initial}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();finish(e.currentTarget.value);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(null);}}}
    onBlur={e=>finish(e.currentTarget.value)}/>;
}

type Props={drafts:Draft[];activeId:string;activeVersionId:string;renamingId:string|null;expanded:ReadonlySet<string>;
  onOpen:(d:Draft)=>void;onVersion:(d:Draft,versionId:string)=>void;onRename:(d:Draft,title:string|null)=>void;onMenu:(event:React.MouseEvent,d:Draft,v?:Version)=>void;onBackgroundMenu:(event:React.MouseEvent)=>void;onStage:(d:Draft,at:DOMRect)=>void;footer?:React.ReactNode};
export function Inbox({drafts,activeId,activeVersionId,renamingId,expanded,onOpen,onVersion,onRename,onMenu,onBackgroundMenu,onStage,footer}:Props){
  const [,tick]=useState(0);
  // Keep "5m ago" honest while the inbox stays open.
  useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),60000);return()=>clearInterval(timer);},[]);
  return <aside className="inbox" aria-label="Drafts" onContextMenu={e=>{if(!(e.target as HTMLElement).closest('.inbox-row,.inbox-version'))onBackgroundMenu(e);}}>
    {/* The window buttons sit here; dragging this strip moves the window. */}
    <div className="inbox-top" data-drag-region/>
    <ul className="inbox-list">{drafts.map((d,i)=>{
      const s=stage(d),text=preview(d),platforms=[...new Set(d.publications.map(p=>p.platform))],active=d.id===activeId;
      const meta=<span className="inbox-meta"><span className={`stage-chip stage-${s}`} data-stage-chip title="Change status">{STAGES[s]}</span>{platforms.length>0&&<span className="inbox-live" title={`Live on ${platforms.map(p=>PLATFORM_NAMES[p]).join(', ')}`}>{platforms.map(p=>PLATFORM_NAMES[p]).join(' · ')}</span>}<span className="inbox-version-count">{d.versions.length} {d.versions.length===1?'version':'versions'}</span></span>;
      return <li key={d.id} className={[d.pinned&&!drafts[i+1]?.pinned&&i<drafts.length-1?'is-last-pinned':'',active?'is-active':''].filter(Boolean).join(' ')||undefined}>
        {renamingId===d.id?<div className={`inbox-row is-renaming ${active?'is-active':''}`}><span className="inbox-heading"><NameField className="inbox-rename" label="Draft name" initial={displayTitle(d)} onDone={title=>onRename(d,title)}/><time className="inbox-time">{relativeTime(d.updatedAt)}</time></span>{meta}</div>:
        <button className={`inbox-row ${active?'is-active':''}`} aria-current={active?'true':undefined} aria-expanded={d.versions.length>1?expanded.has(d.id):undefined} onClick={e=>{const chip=(e.target as HTMLElement).closest<HTMLElement>('[data-stage-chip]');if(chip){onStage(d,chip.getBoundingClientRect());return;}onOpen(d);}} onContextMenu={e=>onMenu(e,d)}>
          <span className="inbox-heading"><Marquee className="inbox-title" text={displayTitle(d)}/><time className="inbox-time" dateTime={d.updatedAt}>{relativeTime(d.updatedAt)}</time></span>
          {text&&<span className={`inbox-preview ${d.summary?'is-summary':''}`}>{text}</span>}
          {meta}
        </button>}
        {expanded.has(d.id)&&d.versions.length>1&&<ul className="inbox-versions" aria-label={`Versions of ${displayTitle(d)}`}>{sortedVersions(d).map(v=>{
          const open=!d.hiddenVersions.includes(v.id);
          return <li key={v.id}><button className={`inbox-version ${active&&v.id===activeVersionId?'is-active':''} ${open?'is-open':'is-closed'}`} aria-current={active&&v.id===activeVersionId?'true':undefined} title={open?undefined:'Closed. Click to open it again.'} onClick={()=>onVersion(d,v.id)} onContextMenu={e=>onMenu(e,d,v)}>
            <span className="inbox-version-preview">{versionPreview(v)}</span><time className="inbox-version-time" dateTime={v.updatedAt}>{relativeTime(v.updatedAt)}</time>
          </button></li>;
        })}</ul>}
      </li>;
    })}{!drafts.length&&<li className="inbox-empty">No drafts yet.</li>}</ul>
    {footer&&<div className="inbox-footer">{footer}</div>}
  </aside>;
}
