import { ChangeSet, Text } from '@codemirror/state';
import {plainText,balancedRange} from './markdown';

export type Span = {from:number; to:number};
export type Candidate = {id:string; text:string; origin:'human'|'ai'; humanEdited?:boolean};
export type Variant = Span & {id:string; original:string; candidates:Candidate[]; active:string|null};
export type Ghost = Span & {id:string};
export type Draft = {format:'writing-room'; version:1; id:string; title:string; text:string; variants:Variant[]; ghosts:Ghost[]; overflow:string; revision:number; revisionMode:boolean; updatedAt:string};
export type Cut = Span & {id:string; text:string; reason:string; accepted:boolean; replacement?:string};
export const id = () => crypto.randomUUID();
export const words=(text:string)=>text.trim().match(/\S+/gu)?.length??0;
export const overlaps=(a:Span,b:Span)=>a.from<b.to && b.from<a.to;
export const contains=(a:Span,b:Span)=>a.from<=b.from && a.to>=b.to;
export function fresh(sample=false):Draft {
  const text=sample ? 'Make room for a better draft.\n\nThe first version is a place to begin, not a place to stay. Good writing often starts with giving an idea a little room to breathe.\n\nTry a different word. Let the sentence take another shape. You don’t have to choose between keeping everything and throwing it away.\n\nThis paragraph might belong somewhere else. Or it might not belong here at all. For now, it can wait quietly while the rest of the piece finds its rhythm.\n\nA useful writing tool should help you hear your own voice more clearly. The decisions are still yours.' : '';
  const start=text.indexOf('a little room to breathe');
  return {format:'writing-room',version:1,id:id(),title:sample?'Room to think':'Untitled draft',text,variants:sample?[{id:id(),from:start,to:start+'a little room to breathe'.length,original:'a little room to breathe',active:null,candidates:[{id:id(),text:'space to find its shape',origin:'human'},{id:id(),text:'time to become something good',origin:'human'}]}]:[],ghosts:[],overflow:sample?'An idea for later:\nThe best tools leave room for a change of mind.':'',revision:0,revisionMode:false,updatedAt:new Date().toISOString()};
}
export function changed(d:Draft, patch:Partial<Draft>):Draft {return {...d,...patch,revision:d.revision+1,updatedAt:new Date().toISOString()};}
export function cleanText(d:Draft, extra:Span[]=[]):string {
  const ranges=[...d.ghosts,...extra].sort((a,b)=>a.from-b.from);
  let cursor=0,result='';
  for(const r of ranges){if(r.from>cursor)result+=d.text.slice(cursor,r.from);cursor=Math.max(cursor,r.to);}
  return (result+d.text.slice(cursor)).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function boundaryError(d:Draft, range:Span):string|null {
  const conflict=d.variants.find(v=>overlaps(v,range)&&!contains(range,v));
  return conflict?'Select the whole marked passage so its alternatives stay together.':null;
}
export function applyChanges(d:Draft, changes:ChangeSet):Draft {
  const text=changes.apply(Text.of(d.text.split('\n'))).toString();
  // Use the editor's position mapping so annotations follow every keystroke.
  const map=(r:Span)=>{let start=1,end=-1;changes.iterChangedRanges((a,b)=>{if(b>a&&a<=r.from&&b>r.from)start=-1;if(b>a&&a<r.to&&b>=r.to)end=1;});return {from:changes.mapPos(r.from,start),to:changes.mapPos(r.to,end)};};
  const variants=d.variants.flatMap(v=>{
    let removed=false;changes.iterChanges((a,b,_c,_e,inserted)=>{if(a<=v.from&&b>=v.to&&(a<v.from||b>v.to||!inserted.length))removed=true;});if(removed)return [];
    const pos=map(v); if(pos.to<=pos.from)return [];
    const selected=text.slice(pos.from,pos.to);
    const before=d.text.slice(v.from,v.to);
    if(selected===before)return [{...v,...pos}];
    const candidates=v.candidates.map(c=>({...c}));
    let active=v.active;
    if(active){const c=candidates.find(c=>c.id===active)!; c.text=selected;if(c.origin==='ai')c.humanEdited=true;}
    else {active=id();candidates.push({id:active,text:selected,origin:'human'});}
    return [{...v,...pos,candidates,active}];
  });
  const ghosts=d.ghosts.flatMap(g=>{let removed=false;changes.iterChanges((a,b)=>{if(a<=g.from&&b>=g.to)removed=true;});if(removed)return [];const p=map(g);return p.to>p.from?[{...g,...p}]:[];});
  return changed(d,{text,variants,ghosts});
}
export function replace(d:Draft,from:number,to:number,insert:string):Draft {
  return applyChanges(d,ChangeSet.of({from,to,insert},d.text.length));
}
export function addVariant(d:Draft, range:Span):{draft:Draft; variantId:string} {
  if(range.from===range.to)throw new Error('Select some words in your draft first.');
  const existing=d.variants.find(v=>overlaps(v,range));
  if(existing){if(contains(existing,range))return {draft:d,variantId:existing.id};throw new Error('This selection overlaps an existing alternative. Select a separate passage.');}
  if(d.ghosts.some(g=>overlaps(g,range)))throw new Error('Revive this passage before adding alternatives.');
  const v:Variant={...range,id:id(),original:d.text.slice(range.from,range.to),candidates:[],active:null};
  return {draft:changed(d,{variants:[...d.variants,v]}),variantId:v.id};
}
export function addCandidate(d:Draft,variantId:string,text:string,origin:'human'|'ai'='human'):Draft {
  if(!text.trim())throw new Error('Give this alternative some words.');
  return changed(d,{variants:d.variants.map(v=>v.id===variantId?{...v,candidates:[...v.candidates,{id:id(),text,origin}]}:v)});
}
export function choose(d:Draft,variantId:string,candidateId:string|null):Draft {
  const v=d.variants.find(v=>v.id===variantId);if(!v)return d;
  const text=candidateId?v.candidates.find(c=>c.id===candidateId)?.text:v.original;
  if(text===undefined||(candidateId===v.active&&d.text.slice(v.from,v.to)===text))return d;
  const article=/\b(a|an)([ \t]+)((?:\*\*|__|~~|\*|_|<u>)*)$/i.exec(d.text.slice(0,v.from));
  const corrected=article?articleFor(text,article[1]):null;
  const articleEdit=article&&corrected&&corrected!==article[1]?{from:article.index,to:article.index+article[1].length,insert:corrected}:null;
  const changes=ChangeSet.of([...(articleEdit?[articleEdit]:[]),{from:v.from,to:v.to,insert:text}],d.text.length);
  const next=applyChanges(d,changes),from=changes.mapPos(v.from,-1);
  // Replacing the complete range deliberately retains the immutable original.
  const updated={...v,from,to:from+text.length,active:candidateId};
  return {...next,variants:[...next.variants.filter(x=>x.id!==v.id),updated].sort((a,b)=>a.from-b.from),ghosts:d.ghosts.map(g=>contains(g,v)?{...g,from:changes.mapPos(g.from,-1),to:changes.mapPos(g.to,1)}:next.ghosts.find(x=>x.id===g.id)!).filter(Boolean)};
}
function articleFor(markdown:string,current:string):string|null {
  const word=plainText(markdown).match(/^["'“‘(]*([\p{L}\p{N}]+)/u)?.[1];if(!word)return null;
  // Pronunciation exceptions before the common vowel rule. Ambiguous initials stay as written.
  const lower=word.toLowerCase();let an:boolean;
  if(/^(honest|honou?r|hour|heir)/.test(lower))an=true;
  else if(/^(uni([^nmd]|$)|use|user|usual|util|euro|ewe|one|once)/.test(lower))an=false;
  else if(/^[A-Z]{2,}$/.test(word)){
    if(/^(NASA|NATO|UNESCO)$/.test(word))an=false;
    else if(/^(FBI|MRI|HTML|HTTP|LCD|X|API|AI|SMS)/.test(word))an=true;
    else if(/^(URL|USB|CPU|PDF|UI|UUID)/.test(word))an=false;
    else return null;
  }else if(/^\d/.test(word)){if(/^(8|11|18)/.test(word))an=true;else return null;}
  else an=/^[aeiou]/i.test(word);
  const result=an?'an':'a';return /^[A-Z]/.test(current)?result[0].toUpperCase()+result.slice(1):result;
}
export function removeCandidate(d:Draft,variantId:string,candidateId:string):Draft {
  const v=d.variants.find(v=>v.id===variantId);if(!v)return d;
  const next=v.active===candidateId?choose(d,variantId,null):d;
  return changed(next,{variants:next.variants.flatMap(x=>{if(x.id!==variantId)return[x];const candidates=x.candidates.filter(c=>c.id!==candidateId);return candidates.length?[{...x,candidates}]:[];})});
}
export function editCandidate(d:Draft,variantId:string,candidateId:string,text:string):Draft {
  const v=d.variants.find(v=>v.id===variantId);if(!v||!text)return d;
  const modified={...d,variants:d.variants.map(x=>x.id===variantId?{...x,candidates:x.candidates.map(c=>c.id===candidateId?{...c,text,humanEdited:c.origin==='ai'||c.humanEdited}:c)}:x)};
  return v.active===candidateId?choose(modified,variantId,candidateId):changed(modified,{});
}
export function ghost(d:Draft,range:Span):Draft {
  if(range.from===range.to)throw new Error('Select a passage to set aside.');
  range=balancedRange(d.text,range);
  const error=boundaryError(d,range);if(error)throw new Error(error);
  const touched=d.ghosts.filter(g=>overlaps(g,range));
  const merged={from:Math.min(range.from,...touched.map(g=>g.from)),to:Math.max(range.to,...touched.map(g=>g.to)),id:id()};
  return changed(d,{ghosts:[...d.ghosts.filter(g=>!overlaps(g,range)),merged].sort((a,b)=>a.from-b.from)});
}
export function stash(d:Draft,range:Span):Draft {
  if(range.from===range.to)throw new Error('Select some words to move into overflow.');
  if([...d.variants,...d.ghosts].some(v=>overlaps(v,range)))throw new Error('This passage has editing history. Use “Copy to overflow” to preserve it in the draft.');
  return changed(replace(d,range.from,range.to,''),{overflow:[d.overflow,d.text.slice(range.from,range.to)].filter(Boolean).join('\n\n')});
}
export function parseDraft(raw:string):Draft {
  if(raw.length>5_000_000)throw new Error('This file is larger than the 5 MB local document limit.');
  let x:any;try{x=JSON.parse(raw);}catch{throw new Error('This is not a valid draft JSON file.');}
  if(x?.format!=='writing-room')throw new Error('Choose a Writing Room .draft.json file.');
  if(x.version!==1)throw new Error('This document uses an unsupported format version.');
  const fail=()=>{throw new Error('The document contains invalid editing data. Your current draft is unchanged.');};
  if(typeof x.id!=='string'||typeof x.title!=='string'||typeof x.text!=='string'||typeof x.overflow!=='string'||!Array.isArray(x.variants)||!Array.isArray(x.ghosts)||!Number.isInteger(x.revision)||x.revision<0||typeof x.revisionMode!=='boolean')fail();
  const ids=new Set<string>();
  const span=(r:any)=>{if(!r||!Number.isInteger(r.from)||!Number.isInteger(r.to)||r.from<0||r.to<=r.from||r.to>x.text.length||typeof r.id!=='string'||ids.has(r.id))fail();ids.add(r.id);};
  x.variants.forEach((v:any)=>{span(v);if(typeof v.original!=='string'||!Array.isArray(v.candidates))fail();const cids=new Set<string>();v.candidates.forEach((c:any)=>{if(!c||typeof c.id!=='string'||cids.has(c.id)||typeof c.text!=='string'||!c.text||!['human','ai'].includes(c.origin)||(c.humanEdited!==undefined&&typeof c.humanEdited!=='boolean'))fail();cids.add(c.id);});if(v.active!==null&&!cids.has(v.active))fail();const active=v.active===null?v.original:v.candidates.find((c:any)=>c.id===v.active).text;if(x.text.slice(v.from,v.to)!==active)fail();});
  x.ghosts.forEach(span);
  for(const ranges of [x.variants,x.ghosts]){const sorted=[...ranges].sort((a:any,b:any)=>a.from-b.from);if(sorted.some((r:any,i:number)=>i>0&&overlaps(r,sorted[i-1])))fail();}
  if(x.ghosts.some((g:any)=>x.variants.some((v:any)=>overlaps(g,v)&&!contains(g,v))))fail();
  return {...x,updatedAt:new Date().toISOString()};
}
export function validateQuotes(d:Draft,items:{text:string;reason?:string;replacement?:string}[]):Cut[] {
  const cuts:Cut[]=[];
  for(const item of items){
    if(typeof item.text!=='string'||!item.text.trim())continue;
    const from=d.text.indexOf(item.text);const to=from+item.text.length;
    if(from<0||d.text.indexOf(item.text,from+1)!==-1)continue;
    const r=item.replacement===undefined?balancedRange(d.text,{from,to}):{from,to};
    if(boundaryError(d,r)||d.ghosts.some(g=>overlaps(g,r))||cuts.some(c=>overlaps(c,r)))continue;
    cuts.push({...r,id:id(),text:d.text.slice(r.from,r.to),reason:typeof item.reason==='string'?item.reason:'Consider removing this passage.',accepted:true,...(typeof item.replacement==='string'&&item.replacement.length<10000?{replacement:item.replacement}:{})});
  }
  return cuts.sort((a,b)=>a.from-b.from);
}
export function makeCuts(d:Draft,cuts:Cut[]):Draft {
  let next=d;
  for(const cut of cuts.filter(c=>c.accepted).sort((a,b)=>b.from-a.from)){
    if(d.text.slice(cut.from,cut.to)!==cut.text)throw Error('The draft changed. Request a fresh trim.');
    next=replace(next,cut.from,cut.to,'');
  }
  return next;
}
export function variantContext(d:Draft,v:Variant):string {
  const separator=d.text.lastIndexOf('\n\n',v.from),end=d.text.indexOf('\n\n',v.to);
  const from=separator<0?0:separator+2,to=end<0?d.text.length:end;
  return cleanText({...d,text:d.text.slice(from,to),ghosts:d.ghosts.filter(g=>g.to>from&&g.from<to).map(g=>({...g,from:Math.max(from,g.from)-from,to:Math.min(to,g.to)-from}))});
}
export function localReview(d:Draft):Cut[] {
  const items:{text:string;reason:string}[]=[];
  for(const m of d.text.matchAll(/[^.!?\n]+[.!?]/g))if(words(m[0])>29)items.push({text:m[0].trim(),reason:'This sentence has more than 29 words. Try breaking it into two thoughts.'});
  const fillers=/\b(in order to|at this point in time|it is important to note that|basically|actually|very|really)\b/gi;
  for(const m of d.text.matchAll(fillers))items.push({text:m[0],reason:'A possible filler. Check whether the sentence needs it.'});
  return validateQuotes(d,items);
}
