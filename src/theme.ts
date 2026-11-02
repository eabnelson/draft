// Light, dark, or following the Mac. The choice is an app preference, never stored in drafts.
export type Appearance='light'|'dark';
export type AppearanceChoice=Appearance|'system';
const KEY='draft:appearance';

export const parseAppearance=(value:unknown):AppearanceChoice=>value==='light'||value==='dark'?value:'system';
export const savedAppearance=():AppearanceChoice=>{try{return parseAppearance(localStorage.getItem(KEY));}catch{return 'system';}};
const systemDark=()=>{try{return matchMedia('(prefers-color-scheme: dark)').matches;}catch{return false;}};
export const resolveAppearance=(choice:AppearanceChoice,prefersDark:boolean):Appearance=>choice==='system'?(prefersDark?'dark':'light'):choice;

function apply(choice:AppearanceChoice){
  const value=resolveAppearance(choice,systemDark()),root=document.documentElement;
  root.classList.toggle('dark',value==='dark');root.style.colorScheme=value;
  // The window's title bar follows too. Outside the Mac app this request simply fails.
  void fetch(`draft-native://localhost/theme/${choice}`).catch(()=>{});
}
export function setAppearance(choice:AppearanceChoice):AppearanceChoice{
  try{localStorage.setItem(KEY,choice);}catch{}
  apply(choice);return choice;
}
// Applied before the first render so the window never flashes the wrong appearance.
export function applySavedAppearance(){
  apply(savedAppearance());
  try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(savedAppearance()==='system')apply('system');});}catch{}
}
