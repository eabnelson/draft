import {ChangeSet,Text} from '@codemirror/state';
import {markdownParser,safeLinkURL} from './markdown';

export type MarkdownLink={from:number;to:number;labelFrom:number;labelTo:number;destination:string;url:string|null};
const reference=(text:string)=>text.trim().replace(/\s+/g,' ').toLowerCase();
function destination(text:string){
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return text.replace(/^<([\s\S]*)>$/,'$1').replace(/\x5c([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g,'$1').replace(/&(amp|lt|gt|quot|apos);/gi,(_m,name:string)=>entities[name.toLowerCase()]);
}
export function markdownLinks(text:string,tree=markdownParser.parse(text)):MarkdownLink[]{
  const references=new Map<string,string>(),links:MarkdownLink[]=[];
  tree.iterate({enter(node){if(node.name!=='LinkReference')return;const label=node.node.getChild('LinkLabel'),url=node.node.getChild('URL');if(label&&url){const key=reference(text.slice(label.from+1,label.to-1));if(!references.has(key))references.set(key,text.slice(url.from,url.to));}}});
  tree.iterate({enter(node){
    if(node.name!=='Link'&&node.name!=='Autolink')return;
    const marks=node.node.getChildren('LinkMark'),opening=marks.find(n=>['[','<'].includes(text.slice(n.from,n.to))),closing=marks.find(n=>[']','>'].includes(text.slice(n.from,n.to)));
    if(!opening||!closing)return;
    const url=node.node.getChild('URL'),label=node.node.getChild('LinkLabel');
    const key=reference(label?text.slice(label.from+1,label.to-1)||text.slice(opening.to,closing.from):text.slice(opening.to,closing.from));
    const address=destination(url?text.slice(url.from,url.to):references.get(key)??'');
    links.push({from:node.from,to:node.to,labelFrom:opening.to,labelTo:closing.from,destination:address,url:safeLinkURL(address)});
  }});
  return links;
}
export function unlinkMarkdown(text:string,link:MarkdownLink,head=link.labelTo) {
  const insert=text.slice(link.labelFrom,link.labelTo),offset=head<=link.from?0:head>=link.to?insert.length:Math.max(0,Math.min(insert.length,head-link.labelFrom)),position=link.from+offset;
  return {changes:[{from:link.from,to:link.labelFrom,insert:''},{from:link.labelTo,to:link.to,insert:''}].filter(r=>r.to>r.from),selection:{from:position,to:position}};
}
// Remove surviving wrappers when an edit destroys a rendered link. Keep every
// unselected label character, including its other Markdown formatting.
export function cleanupLinkChanges(before:string,changes:ChangeSet,links=markdownLinks(before),afterLinks?:MarkdownLink[]):ChangeSet|null {
  const edits:{from:number;to:number}[]=[];changes.iterChangedRanges((from,to)=>edits.push({from,to}));
  const affected=links.filter(link=>edits.some(e=>e.from<link.to&&e.to>link.from||e.from===e.to&&e.from>link.from&&e.from<link.to));
  if(!affected.length)return null;
  const after=changes.apply(Text.of(before.split('\n'))).toString(),parsed=afterLinks??markdownLinks(after),remove:{from:number;to:number}[]=[];
  for(const link of affected){
    if(edits.some(e=>e.from<=link.from&&e.to>=link.to))continue;
    const from=changes.mapPos(link.from,1),to=changes.mapPos(link.to,-1),surviving=parsed.find(l=>l.from===from&&l.to===to);
    if(surviving&&after.slice(surviving.labelFrom,surviving.labelTo).trim())continue;
    for(const [start,end] of [[link.from,link.labelFrom],[link.labelTo,link.to]]){const from=changes.mapPos(start,1),to=changes.mapPos(end,-1);if(to>from)remove.push({from,to});}
  }
  if(!remove.length)return null;
  const merged:{from:number;to:number}[]=[];for(const range of remove.sort((a,b)=>a.from-b.from)){const last=merged.at(-1);if(last&&range.from<=last.to)last.to=Math.max(last.to,range.to);else merged.push({...range});}
  return ChangeSet.of(merged.map(r=>({...r,insert:''})),after.length);
}
