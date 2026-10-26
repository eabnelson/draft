import {parser, GFM} from '@lezer/markdown';
import type {Span} from './model';

export const markdownParser = parser.configure(GFM);
export type TextFormat = 'bold'|'italic'|'underline'|'strike'|'link'|'text'|'h1'|'h2'|'h3'|'bullet'|'number';
export type TextEdit = Span & {insert:string; selection:Span};

// Removing a fully formatted phrase must remove its wrappers as well.
export function balancedRange(text:string,range:Span):Span {
  let result={...range};
  const tree=markdownParser.parse(text);
  for(let pass=0;pass<4;pass++){
    tree.iterate({enter(node){
      if(!['StrongEmphasis','Emphasis','Strikethrough','InlineCode','Link'].includes(node.name))return;
      const marks=node.node.getChildren(node.name==='Link'?'LinkMark':node.name==='InlineCode'?'CodeMark':node.name==='Strikethrough'?'StrikethroughMark':'EmphasisMark');
      const opening=marks[0],closing=node.name==='Link'?marks.find(n=>text.slice(n.from,n.to)===']'):marks.at(-1);
      if(opening&&closing&&result.from<=opening.to&&result.to>=closing.from&&result.from>=node.from&&result.to<=node.to)result={from:node.from,to:node.to};
    }});
    for(const m of text.matchAll(/<u>([^]*?)<\/u>/g))if(result.from<=m.index+3&&result.to>=m.index+3+m[1].length&&result.from>=m.index&&result.to<=m.index+m[0].length)result={from:m.index,to:m.index+m[0].length};
  }
  return result;
}

// Keep Markdown as the document data. Formatting changes source text, never HTML.
export function formatMarkdown(text:string,range:Span,format:TextFormat,href=''):TextEdit {
  let {from,to}=range;
  if(['text','h1','h2','h3','bullet','number'].includes(format)){
    from=text.lastIndexOf('\n',from-1)+1;
    const end=text.indexOf('\n',to>from&&text[to-1]==='\n'?to-1:to);
    to=end<0?text.length:end;
    const lines=text.slice(from,to).split('\n');
    const insert=lines.map((line,i)=>{
      const bare=line.replace(/^(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/,'');
      const prefix=format==='h1'?'# ':format==='h2'?'## ':format==='h3'?'### ':format==='bullet'?'- ':format==='number'?`${i+1}. `:'';
      return prefix+bare;
    }).join('\n');
    return {from,to,insert,selection:{from,to:from+insert.length}};
  }
  if(from===to)throw Error('Select some text to format.');
  const selected=text.slice(from,to);
  if(format==='link'){
    const url=href.trim();
    if(!/^(https?:\/\/|mailto:)/i.test(url))throw Error('Use a web address or mailto: link.');
    let label=selected.replace(/^\[([\s\S]*)\]\([^\n]*\)$/,'$1');
    markdownParser.parse(text).iterate({enter(node){if(node.name!=='Link'||node.from>from||node.to<to)return;const punctuation=node.node.getChildren('LinkMark'),opening=punctuation.find(n=>text.slice(n.from,n.to)==='['),closing=punctuation.find(n=>text.slice(n.from,n.to)===']');if(opening&&closing&&from>=opening.to&&to<=closing.from){label=text.slice(opening.to,closing.from);from=node.from;to=node.to;}}});
    const destination=url.replace(/[\s()<>]/g,c=>c==='('?'%28':c===')'?'%29':encodeURIComponent(c));
    const insert=`[${label}](${destination})`;
    return {from,to,insert,selection:{from:from+1,to:from+1+label.length}};
  }
  const [open,close]=format==='bold'?['**','**']:format==='italic'?['*','*']:format==='strike'?['~~','~~']:['<u>','</u>'];
  let insert:string;
  const italicBoundary=(before:string,after:string)=>format!=='italic'||((before.match(/\*+$/)?.[0].length??0)%2===1&&(after.match(/^\*+/)?.[0].length??0)%2===1);
  if(selected.startsWith(open)&&selected.endsWith(close)&&selected.length>open.length+close.length&&italicBoundary(selected.match(/^\*+/)?.[0]??'',selected.match(/\*+$/)?.[0]??'')){
    insert=selected.slice(open.length,-close.length);
    return {from,to,insert,selection:{from,to:from+insert.length}};
  }
  if(text.slice(from-open.length,from)===open&&text.slice(to,to+close.length)===close&&italicBoundary(text.slice(0,from),text.slice(to))){
    from-=open.length;to+=close.length;insert=selected;
    return {from,to,insert,selection:{from,to:from+insert.length}};
  }
  const leading=selected.match(/^\s*/u)![0],trailing=selected.match(/\s*$/u)![0];
  const body=selected.slice(leading.length,selected.length-trailing.length);
  if(!body)throw Error('Select some text to format.');
  insert=leading+open+body+close+trailing;
  return {from,to,insert,selection:{from:from+leading.length+open.length,to:from+leading.length+open.length+body.length}};
}

export function plainText(markdown:string):string {
  const remove:Span[]=[];
  markdownParser.parse(markdown).iterate({enter(node){
    if(['EmphasisMark','StrikethroughMark','HeaderMark','CodeMark','QuoteMark','LinkMark','ListMark','HTMLTag'].includes(node.name)){let to=node.to;if(['HeaderMark','QuoteMark','ListMark'].includes(node.name))while(/[ \t]/.test(markdown[to]??'')&&to<markdown.length)to++;remove.push({from:node.from,to});}
    if(node.name==='Link'){
      const labelEnd=node.node.getChildren('LinkMark').find(n=>markdown.slice(n.from,n.to)===']');
      if(labelEnd)remove.push({from:labelEnd.from,to:node.to});
    }
  }});
  let pos=0,out='';
  for(const r of remove.sort((a,b)=>a.from-b.from)){if(r.from>pos)out+=markdown.slice(pos,r.from);pos=Math.max(pos,r.to);}
  return (out+markdown.slice(pos)).replace(/^\s+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}

export type WordingScope='word'|'sentence'|'paragraph';
export function scopeRange(text:string,range:Span,scope:WordingScope):Span {
  const point=Math.min(range.from,text.length);
  if(scope==='word'){
    for(const word of text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu))if(word.index<=point&&word.index+word[0].length>=point)return {from:word.index,to:word.index+word[0].length};
    return range;
  }
  let from=0,to=text.length;
  for(const gap of text.matchAll(/\n[ \t]*\n/g)){if(gap.index+gap[0].length<=point)from=gap.index+gap[0].length;else if(gap.index>=point){to=gap.index;break;}}
  if(scope==='sentence'){
    const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
    for(const segment of segmenter.segment(text.slice(from,to)))if(from+segment.index+segment.segment.length>point){from+=segment.index;to=from+segment.segment.length;break;}
  }
  while(from<to&&/\s/.test(text[from]))from++;
  while(to>from&&/\s/.test(text[to-1]))to--;
  return {from,to};
}
