import {useState} from 'react';
import {Keyboard,Monitor,Moon,Sun} from 'lucide-react';
import {savedAppearance,setAppearance,type AppearanceChoice} from './theme';

const CHOICES:[AppearanceChoice,string,typeof Sun][]=[['light','Light',Sun],['dark','Dark',Moon],['system','Match your Mac',Monitor]];

// In Settings: light, dark, or whatever your Mac is set to (the default).
export function AppearanceSetting(){
  const [choice,setChoice]=useState<AppearanceChoice>(savedAppearance);
  return <section className="settings-section" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">Appearance</h2>
    <div className="appearance-choices" role="radiogroup" aria-label="Appearance">
      {CHOICES.map(([value,label,Icon])=><button key={value} type="button" role="radio" aria-checked={choice===value} onClick={()=>setChoice(setAppearance(value))}><Icon size={15}/>{label}</button>)}
    </div>
  </section>;
}

const SHORTCUTS=[
  ['New draft from anywhere','Brings Draft to the front with a blank draft, or hides it if you are already in Draft.','⌥ .'],
  ['New draft','Reuses your latest draft while it is still empty.','⌘ N'],
  ['New version','Opens a copy of the version you are in, in a tab beside it.','⌘ T'],
  ['Switch drafts','⌘1 to ⌘8 open that draft in the sidebar; ⌘9 opens the last one.','⌘ 1 – 9'],
  ['Switch versions','Move between the open version tabs.','⌃ Tab'],
  ['Close tab','Closes the version tab you are in. The draft keeps it.','⌘ W'],
  ['Show or hide the sidebar','Works from anywhere in Draft.','⌘ B'],
  ['Zoom','Make everything larger or smaller; ⌘0 resets.','⌘ + · ⌘ −'],
  ['Undo · Redo','Each version keeps its own history.','⌘ Z · ⇧ ⌘ Z'],
  ['Italic · Underline','Right-click for bold, headings, lists, and links.','⌘ I · ⌘ U'],
  ['Settings','Also the gear in the lower left of the sidebar.','⌘ ,'],
  ['Save now','Drafts also save as you type.','⌘ S'],
] as const;

export function ShortcutList(){
  return <section className="settings-section" aria-labelledby="shortcuts-heading">
    <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
    <div className="shortcut-list">{SHORTCUTS.map(([title,detail,keys])=><div className="help-item" key={title}><Keyboard size={18}/><div><h3>{title}</h3><p>{detail}</p><kbd>{keys}</kbd></div></div>)}</div>
  </section>;
}
