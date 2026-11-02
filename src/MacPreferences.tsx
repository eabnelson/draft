import {useEffect,useState} from 'react';
import {api} from './client';

type Preferences={menuBarIcon:boolean;openAtLogin:boolean};
const OPTIONS:[keyof Preferences,string,string][]=[
  ['openAtLogin','Open at login','Draft starts with your Mac and stays ready for ⌥ . from anywhere.'],
  ['menuBarIcon','Show in menu bar','Open Draft or start a new draft from the menu bar.'],
];
export function MacPreferences(){
  const [value,setValue]=useState<Preferences|null>(null);
  useEffect(()=>{void api<Preferences>('/api/preferences').then(setValue).catch(()=>{});},[]);
  if(!value)return null;
  const change=(key:keyof Preferences,checked:boolean)=>{setValue({...value,[key]:checked});void api<Preferences>('/api/preferences',{[key]:checked}).then(setValue).catch(()=>setValue(value));};
  return <section className="mac-preferences" aria-label="Mac preferences">{OPTIONS.map(([key,label,detail])=><label key={key}><input type="checkbox" checked={value[key]} onChange={e=>change(key,e.target.checked)}/><span><strong>{label}</strong><small>{detail}</small></span></label>)}</section>;
}
