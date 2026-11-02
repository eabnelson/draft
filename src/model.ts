import {plainText} from './markdown';

export type Span = {from:number; to:number};
// A version can be given a name; until then it is called by its first sentence.
export type Version = {id:string; number:number; text:string; name?:string; createdAt:string; updatedAt:string};
export type Platform = 'instagram'|'tiktok'|'x'|'threads'|'youtube';
export const PLATFORMS:Platform[]=['instagram','tiktok','x','threads','youtube'];
// A publication keeps the text exactly as posted, even if its version is edited later.
export type Publication = {id:string; platform:Platform; url:string; versionId:string; publishedAt:string; text:string};
export type TitleSource = 'sentence'|'ai'|'manual';
export type Draft = {format:'draft'; schemaVersion:1; id:string; title:string; titleSource:TitleSource; versions:Version[]; hiddenVersions:string[]; manualStage:Stage|null; pinned:boolean; summary:Summary|null; publications:Publication[]; createdAt:string; updatedAt:string};
export type Stage = 'idea'|'drafting'|'ready'|'live';
// An AI summary for the sidebar, with the word count it was written for.
export type Summary = {text:string; words:number};
export const STAGES:Record<Stage,string>={idea:'Idea',drafting:'Drafting',ready:'Ready',live:'Live'};

export const id = () => crypto.randomUUID();
export const words=(text:string)=>text.trim().match(/\S+/gu)?.length??0;
export const proseWords=(markdown:string)=>words(plainText(markdown));
const WORDS_PER_MINUTE=238;
export const readingMinutes=(count:number)=>count?Math.max(1,Math.round(count/WORDS_PER_MINUTE)):0;
// "40 sec" under a minute, otherwise "3 min".
export function readingTime(count:number):string {
  if(!count)return '';
  const seconds=count/WORDS_PER_MINUTE*60;
  return seconds<60?`${Math.max(1,Math.round(seconds))} sec`:`${readingMinutes(count)} min`;
}
// The short form for version tabs: "12s", "4m", "1h".
export function shortReadingTime(count:number):string {
  if(!count)return '';
  const seconds=count/WORDS_PER_MINUTE*60;
  if(seconds<59.5)return `${Math.max(1,Math.round(seconds))}s`;
  const minutes=Math.round(seconds/60);
  return minutes<60?`${minutes}m`:`${Math.round(minutes/60)}h`;
}
// Characters you would read, without Markdown marks or line breaks.
export const characters=(markdown:string)=>[...plainText(markdown).replace(/\s+/g,' ').trim()].length;
// Below this a draft is still an idea, and has too little text for an AI title.
export const IDEA_WORDS=50;
const TITLE_LENGTH=80;

export function fresh():Draft {
  const now=new Date().toISOString();
  return {format:'draft',schemaVersion:1,id:id(),title:'',titleSource:'sentence',versions:[{id:id(),number:1,text:'',createdAt:now,updatedAt:now}],hiddenVersions:[],manualStage:null,pinned:false,summary:null,publications:[],createdAt:now,updatedAt:now};
}
export const latest=(d:Draft)=>d.versions.reduce((a,b)=>b.number>a.number?b:a);
export const versionById=(d:Draft,versionId:string)=>d.versions.find(v=>v.id===versionId);
// ⌘1–⌘8 pick that item and ⌘9 the last, like tabs in a browser.
export function byShortcut<T>(items:readonly T[],n:number):T|undefined {return n===9?items.at(-1):items[n-1];}
// The versions shown as columns, oldest on the left. Closing a column only hides it.
export function openVersions(d:Draft):Version[] {
  const ordered=[...d.versions].sort((a,b)=>a.number-b.number),open=ordered.filter(v=>!d.hiddenVersions.includes(v.id));
  return open.length?open:[latest(d)];
}
export const isEmpty=(d:Draft)=>!d.publications.length&&d.versions.every(v=>!v.text.trim());
export const displayTitle=(d:Draft)=>d.title.trim()||'Untitled draft';

export function firstSentence(markdown:string):string {
  const prose=plainText(markdown).split('\n').map(line=>line.trim()).find(Boolean)??'';
  let sentence=prose;
  for(const part of new Intl.Segmenter('en',{granularity:'sentence'}).segment(prose)){sentence=part.segment.trim();break;}
  if(sentence.length<=TITLE_LENGTH)return sentence;
  const cut=sentence.slice(0,TITLE_LENGTH),space=cut.lastIndexOf(' ');
  return `${(space>TITLE_LENGTH/2?cut.slice(0,space):cut).replace(/[\s,;:.-]+$/,'')}…`;
}
// Each version is named by its own first sentence, never an AI title.
export const versionTitle=(v:Version)=>v.name?.trim()||firstSentence(v.text);
// Idea and drafting follow the writing, live follows publishing; you can always set it by hand.
export function autoStage(d:Draft):Stage {
  if(d.publications.length)return 'live';
  return d.versions.length===1&&proseWords(d.versions[0].text)<IDEA_WORDS?'idea':'drafting';
}
export const stage=(d:Draft):Stage=>d.manualStage??autoStage(d);
// Changing the status or pinning is not an edit, so the draft keeps its place and "last edited" time.
export function setStage(d:Draft,manualStage:Stage|null):Draft {return {...d,manualStage};}
// Choosing the stage Draft would work out anyway goes back to following it automatically.
export function chooseStage(d:Draft,chosen:Stage):Draft {return setStage(d,chosen===autoStage(d)?null:chosen);}
export const SUMMARY_WORDS=25;
// A summary is worth writing once there is something to sum up, and again after the draft changes a fair amount.
export function needsSummary(d:Draft):boolean {
  const count=proseWords(latest(d).text);if(count<SUMMARY_WORDS)return false;
  return !d.summary||Math.abs(count-d.summary.words)>=Math.max(SUMMARY_WORDS,d.summary.words*.2);
}
export function setSummary(d:Draft,text:string,words:number):Draft {return {...d,summary:{text:text.trim().slice(0,300),words}};}
export function setPinned(d:Draft,pinned:boolean):Draft {return {...d,pinned};}
// Pinned drafts come first; within each group the most recently edited is on top.
export function inboxOrder(drafts:readonly Draft[]):Draft[] {
  return [...drafts].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
}

// Only writing counts as an edit and moves a draft up the sidebar. Opening, closing,
// adding or deleting versions, and renaming keep its place and last-edited time.
function touch(d:Draft,patch:Partial<Draft>,edited=false):Draft {
  const next={...d,...patch,...edited?{updatedAt:new Date().toISOString()}:{}};
  // Until it is renamed or the AI suggests one, the title follows the newest version's first sentence.
  return next.titleSource==='sentence'?{...next,title:firstSentence(latest(next).text)}:next;
}
export function editVersion(d:Draft,versionId:string,text:string):Draft {
  const current=versionById(d,versionId);if(!current||current.text===text)return d;
  const now=new Date().toISOString();
  return touch(d,{versions:d.versions.map(v=>v.id===versionId?{...v,text,updatedAt:now}:v)},true);
}
// Naming a version, like renaming a draft, does not move it up the sidebar. An empty name
// goes back to the first sentence.
export function renameVersion(d:Draft,versionId:string,name:string):Draft {
  const clean=name.replace(/\s+/g,' ').trim().slice(0,200);
  return touch(d,{versions:d.versions.map(v=>{if(v.id!==versionId)return v;const {name:_old,...rest}=v;return clean?{...rest,name:clean}:rest;})});
}
export function rename(d:Draft,title:string):Draft {
  return title.trim()?touch(d,{title,titleSource:'manual'}):touch(d,{title:'',titleSource:'sentence'});
}
export function aiTitle(d:Draft,title:string):Draft {
  return d.titleSource==='sentence'&&title.trim()?touch(d,{title:title.trim().slice(0,TITLE_LENGTH),titleSource:'ai'}):d;
}
// New versions start from the latest, from a chosen version, or blank.
export function addVersion(d:Draft,from:'latest'|'blank'|string='latest'):{draft:Draft;version:Version} {
  const source=from==='blank'?undefined:from==='latest'?latest(d):versionById(d,from);
  if(from!=='blank'&&!source)throw Error('That version no longer exists.');
  const now=new Date().toISOString(),version={id:id(),number:latest(d).number+1,text:source?.text??'',createdAt:now,updatedAt:now};
  return {draft:touch(d,{versions:[...d.versions,version]}),version};
}
export function setVersionHidden(d:Draft,versionId:string,hidden:boolean):Draft {
  const hiddenVersions=d.hiddenVersions.filter(x=>x!==versionId);
  return touch(d,{hiddenVersions:hidden?[...hiddenVersions,versionId]:hiddenVersions});
}
export function deleteVersion(d:Draft,versionId:string):Draft {
  if(d.versions.length===1)throw Error('A draft needs at least one version.');
  if(d.publications.some(p=>p.versionId===versionId))throw Error('This version was published. Remove its publications first.');
  return touch(d,{versions:d.versions.filter(v=>v.id!==versionId),hiddenVersions:d.hiddenVersions.filter(x=>x!==versionId)});
}

const ISO=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const SAFE_ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/;
// draft.json carries metadata; version text lives beside it as Markdown files.
export type DraftRecord = Omit<Draft,'versions'>&{versions:Omit<Version,'text'>[]};
export function toRecord(d:Draft):DraftRecord {return {...d,versions:d.versions.map(({text:_text,...v})=>v)};}
export function parseDraft(record:unknown,texts:Record<string,string>):Draft {
  const x=record as Record<string,any>,fail=():never=>{throw Error('This draft contains invalid data.');};
  if(!x||x.format!=='draft')fail();
  if(x.schemaVersion!==1)throw Error('This draft needs a newer version of Draft.');
  if(typeof x.id!=='string'||!SAFE_ID.test(x.id)||typeof x.title!=='string'||x.title.length>500||!['sentence','ai','manual'].includes(x.titleSource)||(x.ready!==undefined&&typeof x.ready!=='boolean')||(x.manualStage!=null&&!(x.manualStage in STAGES))||(x.pinned!==undefined&&typeof x.pinned!=='boolean')||(x.summary!=null&&(typeof x.summary.text!=='string'||x.summary.text.length>300||!Number.isInteger(x.summary.words)))||!ISO(x.createdAt)||!ISO(x.updatedAt))fail();
  if(!Array.isArray(x.versions)||!x.versions.length||x.versions.length>1000||!Array.isArray(x.hiddenVersions)||!Array.isArray(x.publications))fail();
  const ids=new Set<string>(),numbers=new Set<number>();
  const versions:Version[]=x.versions.map((v:any)=>{
    if(!v||typeof v.id!=='string'||!SAFE_ID.test(v.id)||ids.has(v.id)||(v.name!==undefined&&(typeof v.name!=='string'||v.name.length>200))||!Number.isInteger(v.number)||v.number<1||numbers.has(v.number)||!ISO(v.createdAt)||!ISO(v.updatedAt))fail();
    const text=texts[v.id];if(typeof text!=='string')fail();
    ids.add(v.id);numbers.add(v.number);return {id:v.id,number:v.number,text,...v.name?.trim()?{name:v.name.trim()}:{},createdAt:v.createdAt,updatedAt:v.updatedAt};
  }).sort((a:Version,b:Version)=>a.number-b.number);
  const publications:Publication[]=x.publications.map((p:any)=>{
    if(!p||typeof p.id!=='string'||!PLATFORMS.includes(p.platform)||typeof p.url!=='string'||!/^https:\/\//.test(p.url)||!ids.has(p.versionId)||!ISO(p.publishedAt)||typeof p.text!=='string')fail();
    return {id:p.id,platform:p.platform,url:p.url,versionId:p.versionId,publishedAt:p.publishedAt,text:p.text};
  });
  // Drafts marked ready before manual statuses existed stay ready.
  const {ready,...rest}=x,manualStage:Stage|null=x.manualStage??(ready===true&&!publications.length?'ready':null);
  // Unknown fields from newer or personal features are kept as they are.
  return {...rest,manualStage,pinned:x.pinned===true,summary:x.summary?{text:x.summary.text,words:x.summary.words}:null,versions,hiddenVersions:x.hiddenVersions.filter((v:unknown)=>typeof v==='string'&&ids.has(v)),publications} as Draft;
}

// Draft 1 documents become a single version that reads exactly as the writing did.
export function migrateLegacy(raw:unknown):Draft {
  const x=raw as Record<string,any>;
  if(x?.format!=='writing-room'||x.version!==1||typeof x.id!=='string'||!SAFE_ID.test(x.id)||typeof x.text!=='string')throw Error('This is not a Draft document.');
  const overflow=typeof x.overflow==='string'&&x.overflow.trim()?`\n\n## Overflow\n\n${x.overflow.trim()}`:'';
  const text=(x.text.trimEnd()+overflow).replace(/\]\(\/api\/images\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))/g,'](media/$1').replace(/ (\/api\/images\/)([a-f0-9]{32}\.(?:png|jpg|webp|gif))"\)/g,' media/$2")');
  const at=ISO(x.updatedAt)?x.updatedAt:new Date().toISOString(),untitled=typeof x.title!=='string'||!x.title.trim()||['Untitled draft','Room to think'].includes(x.title.trim());
  const draft:Draft={format:'draft',schemaVersion:1,id:x.id,title:untitled?'':x.title.trim(),titleSource:untitled?'sentence':'manual',versions:[{id:id(),number:1,text,createdAt:at,updatedAt:at}],hiddenVersions:[],manualStage:null,pinned:false,summary:null,publications:[],createdAt:at,updatedAt:at};
  return untitled?{...draft,title:firstSentence(text)}:draft;
}
