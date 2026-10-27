import {useEffect,useRef,useState} from 'react';
import {Bold,Italic,Underline,Strikethrough,Link,ChevronDown,Check} from 'lucide-react';
import type {TextFormat} from './markdown';
import {Button} from './components/ui/button';
import {api} from './client';
import type {SpellingWord} from './editor-spelling';

type Props={x:number;y:number;revive?:boolean;spelling?:SpellingWord;onSpellingFix?:(text:string)=>void;writingActions?:boolean;onFormat:(format:TextFormat,href?:string)=>void;onAction?:(action:string)=>void;onClose:(restoreFocus?:boolean)=>void};
export function TextMenu({x,y,revive,spelling,onSpellingFix,writingActions,onFormat,onAction,onClose}:Props){
  const ref=useRef<HTMLDivElement>(null),[blocks,setBlocks]=useState(false),[link,setLink]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState('');
  const [suggestions,setSuggestions]=useState<string[]|null>(null);
  useEffect(()=>{if(!spelling)return;const controller=new AbortController();setSuggestions(null);void api('/api/spelling/suggestions',{word:spelling.word},controller.signal).then(result=>{if(!controller.signal.aborted)setSuggestions(result.suggestions);}).catch(()=>{if(!controller.signal.aborted)setSuggestions([]);});return()=>controller.abort();},[spelling?.word]);
  const [position,setPosition]=useState({left:Math.max(8,Math.min(x,window.innerWidth-286)),top:Math.max(8,Math.min(y,window.innerHeight-350))});
  useEffect(()=>{
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const pointer=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))onClose();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose(true);}};
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key,true);};
  },[]);
  useEffect(()=>{const r=ref.current?.getBoundingClientRect();if(r)setPosition(p=>({left:Math.min(p.left,Math.max(8,innerWidth-r.width-8)),top:Math.min(p.top,Math.max(8,innerHeight-r.height-8))}));},[blocks,link,suggestions]);
  function format(value:TextFormat,address?:string){try{onFormat(value,address);onClose();}catch(e){setError(e instanceof Error?e.message:'This format could not be applied.');}}
  return <div className="text-menu" style={position} ref={ref} role="menu" aria-label="Text options" onKeyDown={e=>{
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!(e.target instanceof HTMLInputElement)){
      const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const i=buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
    }
    if(e.key==='Tab')onClose();
  }}>
    {spelling&&<div className="spelling-suggestions">{suggestions===null?<span role="status">Checking spelling…</span>:suggestions.length?suggestions.map(text=><Button variant="ghost" role="menuitem" key={text} onClick={()=>{onSpellingFix?.(text);onClose();}}>{text}</Button>):<span>No spelling suggestions</span>}</div>}
    <div className="format-row">{([['bold',Bold],['italic',Italic],['underline',Underline],['strike',Strikethrough]] as const).map(([name,Icon])=><Button key={name} variant="ghost" size="icon-sm" role="menuitem" aria-label={name==='strike'?'Strikethrough':name[0].toUpperCase()+name.slice(1)} title={name} onClick={()=>format(name)}><Icon size={16}/></Button>)}<Button variant="ghost" size="icon-sm" role="menuitem" aria-label="Add link" onClick={()=>{setLink(!link);setBlocks(false);}}><Link size={16}/></Button><Button variant="ghost" role="menuitem" className="block-format-toggle" onClick={()=>{setBlocks(!blocks);setLink(false);}}>Text<ChevronDown size={13}/></Button></div>
    {blocks&&<div className="block-formats">{([['text','Text'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3'],['number','Numbered list'],['bullet','Bulleted list']] as const).map(([name,label])=><Button variant="ghost" role="menuitem" key={name} onClick={()=>format(name)}>{label}</Button>)}</div>}
    {link&&<form className="link-entry" onSubmit={e=>{e.preventDefault();format('link',url);}}><input autoFocus aria-label="Link address" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/><Button type="submit" size="icon-sm" aria-label="Apply link"><Check size={15}/></Button></form>}
    {writingActions&&<div className="writing-menu-actions">{[['alternative','Alternatives'],['ai-alternative','AI alternatives for selection'],['ghost',revive?'Revive':'Ghost it'],['overflow','Stash in overflow']].map(([name,label])=><Button variant="ghost" role="menuitem" key={name} onClick={()=>{onAction?.(name);onClose();}}>{label}</Button>)}</div>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
