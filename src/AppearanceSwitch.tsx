import {useState} from 'react';
import {Check,Moon,Sun} from 'lucide-react';
import {savedAppearance,setAppearance,type AppearanceChoice} from './theme';

const CHOICES=[['light','Light','Bright and clear'],['dark','Dark','Calm after hours'],['system','System','Follow your device']] as const;

function WorkspacePreview({dark=false}:{dark?:boolean}){
  return <span className={`appearance-scene ${dark?'is-night':'is-day'}`}>
    {dark?<Moon className="appearance-sky-icon" size={19}/>:<Sun className="appearance-sky-icon" size={21}/>}
    <span className="appearance-window">
      <span className="appearance-mini-sidebar"><i/><i/><i/></span>
      {[0,1].map(column=><span className="appearance-mini-writing" key={column}><span className="appearance-mini-tab"><i/><i/></span><b/><i/><i/><i/></span>)}
    </span>
  </span>;
}

// In Settings: light, dark, or system (whatever your Mac is set to, the default).
export function AppearanceSetting({onChange}:{onChange?:(choice:AppearanceChoice)=>void}={}){
  const [choice,setChoice]=useState<AppearanceChoice>(savedAppearance);
  const choose=(value:AppearanceChoice)=>{setChoice(setAppearance(value));onChange?.(value);};
  return <section className="settings-section" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">Make yourself at home.</h2>
    <p className="settings-detail appearance-detail">A little light, a quieter night, or a workspace that follows your day.</p>
    <div className="appearance-choices" role="radiogroup" aria-label="Appearance">
      {CHOICES.map(([value,label,detail],index)=><button key={value} type="button" role="radio" aria-label={label} aria-checked={choice===value} tabIndex={choice===value?0:-1} onClick={()=>choose(value)} onKeyDown={event=>{
        let next:number;
        if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%CHOICES.length;
        else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+CHOICES.length-1)%CHOICES.length;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=CHOICES.length-1;
        else return;
        event.preventDefault();choose(CHOICES[next][0]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
      }}>
        <span className={`appearance-preview appearance-preview-${value}`} aria-hidden="true"><WorkspacePreview dark={value==='dark'}/>{value==='system'&&<WorkspacePreview dark/>}</span>
        <span className="appearance-caption"><span><strong>{label}</strong><small>{detail}</small></span><span className="appearance-check" aria-hidden="true">{choice===value&&<Check size={12}/>}</span></span>
      </button>)}
    </div>
  </section>;
}

const SHORTCUTS=[
  {title:'New draft from anywhere',detail:'Bring Draft forward with a blank draft. Available in the desktop app.',keys:[['alt','.']]},
  {title:'New draft',detail:'Reuse your latest draft while it is still empty.',keys:[['mod','N']]},
  {title:'New version',detail:'Open a copy of the current version beside it.',keys:[['mod','T']]},
  {title:'Switch drafts',detail:'Select drafts 1–8 in the sidebar; 9 selects the last.',keys:[['mod','1'],['mod','9']],separator:'…'},
  {title:'Next version',detail:'Move through open tabs, including from the sidebar.',keys:[['control','Tab']]},
  {title:'Previous version',detail:'Move backward through the open tabs.',keys:[['control','shift','Tab']]},
  {title:'Close tab',detail:'Close this tab while keeping its writing.',keys:[['mod','W']]},
  {title:'Show or hide sidebar',detail:'Give your writing a little more room.',keys:[['mod','B']]},
  {title:'Zoom',detail:'Make the interface larger or smaller; 0 resets it.',keys:[['mod','+'],['mod','−'],['mod','0']]},
  {title:'Undo',detail:'Each version keeps its own history.',keys:[['mod','Z']]},
  {title:'Redo',detail:'Bring back the change you just undid.',keys:[['mod','shift','Z']]},
  {title:'Italic · Underline',detail:'Right-click for bold, headings, lists, and links.',keys:[['mod','I'],['mod','U']]},
  {title:'Settings',detail:'Open Settings; Escape takes you back to writing.',keys:[['mod',',']]},
  {title:'Save now',detail:'Drafts also save as you type.',keys:[['mod','S']]},
];

export function ShortcutList(){
  const mac=document.documentElement.dataset.platform==='mac'||/Mac|iPhone|iPad/.test(navigator.platform);
  const name=(key:string)=>({mod:mac?'Command':'Control',control:'Control',alt:mac?'Option':'Alt',shift:'Shift'}[key]??key);
  const symbol=(key:string)=>({mod:mac?'⌘':'Ctrl',control:mac?'⌃':'Ctrl',alt:mac?'⌥':'Alt',shift:mac?'⇧':'Shift'}[key]??key);
  return <section className="settings-section" aria-labelledby="shortcuts-heading">
    <h2 id="shortcuts-heading">Keep your hands on the keys.</h2>
    <p className="settings-detail shortcuts-detail">A few familiar moves, wherever your next thought takes you.</p>
    <div className="shortcut-list">{SHORTCUTS.map(({title,detail,keys,separator})=><article className="shortcut-card" key={title}>
      <div className="shortcut-keys">{keys.map((combination,index)=><span className="shortcut-alternative" key={index}>{index>0&&<span className="shortcut-or" aria-hidden="true">{separator??'or'}</span>}<span className="shortcut-combination" role="img" aria-label={combination.map(name).join(' + ')}>{combination.map((key,i)=><kbd key={i} className={['mod','control','alt','shift'].includes(key)?'is-modifier':undefined} aria-hidden="true">{symbol(key)}</kbd>)}</span></span>)}</div>
      <h3>{title}</h3><p>{detail}</p>
    </article>)}</div>
  </section>;
}
