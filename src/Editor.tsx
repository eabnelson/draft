import {useEffect,useRef,useState,forwardRef,useImperativeHandle} from 'react';
import {EditorState,StateEffect,StateField,ChangeSet,Prec} from '@codemirror/state';
import {EditorView,Decoration,keymap,placeholder,drawSelection,WidgetType,ViewPlugin,type DecorationSet} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import {type Draft,type Span,type Cut,overlaps,contains,variantScope} from './model';
import {formatMarkdown,type TextFormat,type WordingScope} from './markdown';
import {markdownEditing,showMarkdown} from './editor-markdown';
import {TextMenu} from './TextMenu';

type Annotations={draft:Draft;active:string|null;cuts:Cut[];reviewing?:boolean;focusPassage?:boolean};
const annotate=StateEffect.define<Annotations>();
class WordingDots extends WidgetType {
  constructor(readonly count:number,readonly selected:number,readonly id:string,readonly scope:WordingScope){super();}
  eq(other:WordingDots){return other.count===this.count&&other.selected===this.selected&&other.id===this.id&&other.scope===this.scope;}
  toDOM(){
    const span=document.createElement('span'),dots=document.createElement('span');
    span.className=`wording-dots is-${this.scope} ${this.selected?'is-alternate':''}`;span.dataset.variant=this.id;span.dataset.wordingScope=this.scope;span.style.setProperty('--wording-count',String(this.count));
    const label=`${this.selected?'Alternative':'Original'} wording · ${this.selected+1} of ${this.count}`;
    span.setAttribute('role','img');span.setAttribute('aria-label',label);span.title=`${label}. Use ← → to compare.`;
    dots.className='wording-options';dots.setAttribute('aria-hidden','true');
    for(let i=0;i<this.count;i++){const dot=document.createElement('i');if(i===this.selected)dot.className='is-selected';dots.append(dot);}
    if(this.scope==='paragraph'){const rail=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');rail.classList.add('wording-rail');rail.setAttribute('width','6');rail.setAttribute('aria-hidden','true');rail.append(path);span.append(rail);}
    span.append(dots);return span;
  }
  ignoreEvent(){return false;}
}
// Measure the rendered passage after wrapping, Markdown, and viewport scaling.
const centerWordingDots=ViewPlugin.define(view=>{
  const measure={
    read(view:EditorView){
      const passages=new Map<string,DOMRect[]>();
      for(const mark of view.contentDOM.querySelectorAll<HTMLElement>('.variant[data-variant]')){
        const id=mark.dataset.variant!,rects=passages.get(id)??[];
        rects.push(...Array.from(mark.getClientRects()).filter(r=>r.width>0));passages.set(id,rects);
      }
      return Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.wording-dots'),dot=>{
        if(dot.dataset.wordingScope==='sentence')return {dot,offset:0,top:0,height:0};
        const rects=passages.get(dot.dataset.variant!)??[],last=rects.at(-1);
        if(!last)return {dot,offset:0,top:0,height:0};
        if(dot.dataset.wordingScope==='paragraph'){
          const top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom)),anchor=dot.getBoundingClientRect();
          return {dot,offset:(Math.min(...rects.map(r=>r.left))-18-anchor.left)/view.scaleX,top:(top-anchor.top)/view.scaleY,height:(bottom-top)/view.scaleY};
        }
        const line=rects.filter(r=>r.top<last.bottom&&r.bottom>last.top);
        const center=(Math.min(...line.map(r=>r.left))+Math.max(...line.map(r=>r.right)))/2;
        return {dot,offset:(center-dot.getBoundingClientRect().left)/view.scaleX,top:0,height:0};
      });
    },
    write(positions:{dot:HTMLElement;offset:number;top:number;height:number}[]){for(const {dot,offset,top,height} of positions){
      dot.style.setProperty('--wording-center',`${offset}px`);dot.style.setProperty('--wording-top',`${top}px`);dot.style.setProperty('--wording-height',`${height}px`);
      const rail=dot.querySelector('svg');if(rail){rail.setAttribute('height',String(height));let path='M3 0';for(let y=0;y<height;y+=4)path+=`Q${y%8?6:0} ${y+2} 3 ${y+4}`;rail.querySelector('path')!.setAttribute('d',path);}
    }},
  };
  view.requestMeasure(measure);
  return {docViewUpdate:()=>view.requestMeasure(measure),update:(update)=>{if(update.geometryChanged)view.requestMeasure(measure);}};
});
const decorations=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update(value,tr){
    const effect=tr.effects.find(e=>e.is(annotate));if(!effect)return value.map(tr.changes);
    const {draft:d,active,cuts,reviewing,focusPassage}=effect.value as Annotations,marks=[];
    const focused=d.variants.find(v=>v.id===active);
    if(focusPassage&&focused){const before=d.text.lastIndexOf('\n\n',focused.from),after=d.text.indexOf('\n\n',focused.to),from=before<0?0:before+2,to=after<0?d.text.length:after;for(let n=1;n<=tr.state.doc.lines;n++){const line=tr.state.doc.line(n);if(line.to<from||line.from>to)marks.push(Decoration.line({class:'passage-muted'}).range(line.from));}}
    if(d.revisionMode){
      for(const v of d.variants)if(v.candidates.length){
        const scope=variantScope(v);
        marks.push(Decoration.mark({class:`variant variant-${scope} ${v.active?'variant-chosen':''} ${v.id===active?'variant-focused':''}`,inclusiveEnd:scope==='sentence',attributes:{'data-variant':v.id,title:'Hover and use ← → to compare wordings'}}).range(v.from,v.to));
        if(scope==='sentence'){const tail=/\S+\s*$/.exec(d.text.slice(v.from,v.to));if(tail)marks.push(Decoration.mark({class:'sentence-ending',inclusiveEnd:true}).range(v.from+tail.index,v.to));}
        marks.push(Decoration.widget({widget:new WordingDots(v.candidates.length+1,v.active===null?0:v.candidates.findIndex(c=>c.id===v.active)+1,v.id,scope),side:scope==='sentence'?-1:1}).range(v.to));
      }
      for(const g of d.ghosts)marks.push(Decoration.mark({class:'ghost-text',attributes:{'data-ghost':g.id,'aria-label':'Ghosted text. Right-click to revive.',title:'Ghosted — right-click to revive'}}).range(g.from,g.to));
    }else for(const g of d.ghosts)marks.push(Decoration.replace({}).range(g.from,g.to));
    for(const c of cuts)if(c.accepted)marks.push(Decoration.mark({class:reviewing?'review-highlight':'cut-preview',attributes:{'data-cut':c.id,title:c.reason}}).range(c.from,c.to));
    return Decoration.set(marks,true);
  },provide:field=>EditorView.decorations.from(field)
});
export type EditorHandle={focus:()=>void;select:(range:Span)=>void};
type Props={draft:Draft;active:string|null;cuts:Cut[];reviewing?:boolean;source?:boolean;focusPassage?:boolean;onChange:(changes:ChangeSet)=>void;onSelection:(range:Span,user?:boolean)=>void;onVariant:(id:string)=>void;onCycle:(id:string,direction:number)=>void;onCut?:(id:string)=>void;onError:(message:string)=>void;onAction:(action:string)=>void};

function replacement(before:string,after:string){let from=0,oldTo=before.length,newTo=after.length;while(from<oldTo&&from<newTo&&before[from]===after[from])from++;while(oldTo>from&&newTo>from&&before[oldTo-1]===after[newTo-1]){oldTo--;newTo--;}return {from,to:oldTo,insert:after.slice(from,newTo)};}
function selectContext(view:EditorView,event:MouseEvent):Span {
  const point=view.posAtCoords({x:event.clientX,y:event.clientY}),selection=view.state.selection.main;
  if(point===null)return selection;
  if(!selection.empty&&point>=selection.from&&point<=selection.to)return selection;
  const range=view.state.wordAt(point)??{from:point,to:point};view.dispatch({selection:{anchor:range.from,head:range.to}});return range;
}
function applyFormat(view:EditorView,format:TextFormat,href?:string){const edit=formatMarkdown(view.state.doc.toString(),view.state.selection.main,format,href);view.dispatch({changes:{from:edit.from,to:edit.to,insert:edit.insert},selection:{anchor:edit.selection.from,head:edit.selection.to},userEvent:'input.format'});view.focus();}

export const Editor=forwardRef<EditorHandle,Props>(function Editor(props,ref){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),current=useRef(props),syncing=useRef(false),hovered=useRef<string|null>(null);
  const [menu,setMenu]=useState<{x:number;y:number;range:Span}|null>(null);current.current=props;
  useImperativeHandle(ref,()=>({focus:()=>view.current?.focus(),select:r=>{view.current?.dispatch({selection:{anchor:r.from,head:r.to},scrollIntoView:true});view.current?.focus();}}));
  useEffect(()=>{
    const v=new EditorView({parent:host.current!,state:EditorState.create({doc:current.current.draft.text,extensions:[
      markdownEditing,decorations,centerWordingDots,EditorView.lineWrapping,placeholder('Start writing…'),drawSelection({drawRangeCursor:false}),
      EditorView.contentAttributes.of({'aria-label':'Draft body',role:'textbox','aria-multiline':'true',spellcheck:'true',autocapitalize:'sentences'}),
      Prec.highest(keymap.of([
        {key:'Mod-z',run:()=>{current.current.onAction('undo');return true;}},{key:'Mod-Shift-z',run:()=>{current.current.onAction('redo');return true;}},
        {key:'Mod-Shift-a',run:()=>{current.current.onAction('alternative');return true;}},{key:'Mod-Shift-g',run:()=>{current.current.onAction('ghost');return true;}},{key:'Mod-Shift-o',run:()=>{current.current.onAction('overflow');return true;}},
        ...(['b','i','u'] as const).map((key,i)=>({key:`Mod-${key}`,run:(editor:EditorView)=>{try{applyFormat(editor,(['bold','italic','underline'] as const)[i]);}catch(e){current.current.onError((e as Error).message);}return true;}})),
      ])),keymap.of(defaultKeymap),
      EditorState.transactionFilter.of(tr=>{
        if(syncing.current||!tr.docChanged)return tr;let invalid=false;
        tr.changes.iterChangedRanges((from,to)=>{if(from===to)return;for(const wording of current.current.draft.variants){const r={from,to};if(overlaps(r,wording)&&!contains(wording,r)&&!contains(r,wording))invalid=true;}});
        if(invalid){queueMicrotask(()=>current.current.onError('Select the whole marked passage, or edit within it.'));return [];}
        return tr;
      }),
      EditorView.updateListener.of(update=>{if(syncing.current)return;if(update.docChanged)current.current.onChange(update.changes);if(update.selectionSet||update.docChanged){const {from,to}=update.state.selection.main;current.current.onSelection({from,to},true);}}),
      EditorView.domEventHandlers({
        mousedown:event=>{const cut=(event.target as HTMLElement).closest<HTMLElement>('[data-cut]');if(event.button===0&&cut&&current.current.onCut&&!current.current.reviewing){event.preventDefault();current.current.onCut(cut.dataset.cut!);return true;}return false;},
        mousemove:event=>{hovered.current=(event.target as HTMLElement).closest<HTMLElement>('[data-variant]')?.dataset.variant??null;return false;},
        mouseleave:()=>{hovered.current=null;return false;},
        keydown:event=>{if(!event.key.startsWith('Arrow'))hovered.current=null;return false;},
        click:event=>{const el=(event.target as HTMLElement).closest<HTMLElement>('[data-variant]');if(el)current.current.onVariant(el.dataset.variant!);return false;},
        contextmenu:(event,editor)=>{event.preventDefault();const range=selectContext(editor,event);current.current.onSelection(range);setMenu({x:event.clientX,y:event.clientY,range});return true;},
      }),
    ]})});view.current=v;
    const arrows=(event:KeyboardEvent)=>{
      if(!current.current.draft.revisionMode||!hovered.current||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
      if(event.target instanceof Element&&event.target.closest('input,textarea,[role="menu"],.markdown-field'))return;
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||!v.state.selection.main.empty)return;
      event.preventDefault();event.stopPropagation();current.current.onCycle(hovered.current,event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1);
    };
    window.addEventListener('keydown',arrows,true);
    return()=>{window.removeEventListener('keydown',arrows,true);v.destroy();view.current=null;};
  },[]);
  useEffect(()=>{
    const v=view.current;if(!v)return;syncing.current=true;
    try{const before=v.state.doc.toString(),after=props.draft.text;v.dispatch({...(before!==after?{changes:replacement(before,after)}:{}),effects:[annotate.of({draft:props.draft,active:props.active,cuts:props.cuts,reviewing:props.reviewing,focusPassage:props.focusPassage}),showMarkdown.of(!!props.source)]});if(before!==after){const {from,to}=v.state.selection.main;props.onSelection({from,to});}}finally{syncing.current=false;}
  },[props.draft,props.active,props.cuts,props.reviewing,props.source,props.focusPassage]);
  return <><div className="editor-host" ref={host}/>{menu&&<TextMenu x={menu.x} y={menu.y} writingActions revive={props.draft.ghosts.some(g=>overlaps(g,menu.range))} onAction={props.onAction} onFormat={(format,href)=>applyFormat(view.current!,format,href)} onClose={restore=>{setMenu(null);if(restore)view.current?.focus();}}/>}</>;
});

type FieldProps={label:string;value:string;onChange:(value:string)=>void;placeholder?:string;className?:string;source?:boolean};
export function MarkdownField(props:FieldProps){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),current=useRef(props),syncing=useRef(false);current.current=props;
  const [menu,setMenu]=useState<{x:number;y:number}|null>(null);
  useEffect(()=>{
    const v=new EditorView({parent:host.current!,state:EditorState.create({doc:props.value,extensions:[markdownEditing,EditorView.lineWrapping,history(),keymap.of([
      ...(['b','i','u'] as const).map((key,i)=>({key:`Mod-${key}`,run:(editor:EditorView)=>{try{applyFormat(editor,(['bold','italic','underline'] as const)[i]);}catch{}return true;}})),...historyKeymap,...defaultKeymap,
    ]),placeholder(props.placeholder??''),EditorView.contentAttributes.of({'aria-label':props.label,role:'textbox','aria-multiline':'true',spellcheck:'true'}),
    EditorView.updateListener.of(update=>{if(update.docChanged&&!syncing.current)current.current.onChange(update.state.doc.toString());}),
    EditorView.domEventHandlers({contextmenu:(event,editor)=>{event.preventDefault();selectContext(editor,event);setMenu({x:event.clientX,y:event.clientY});return true;}}),
    ]})});view.current=v;return()=>{v.destroy();view.current=null;};
  },[]);
  useEffect(()=>{const v=view.current;if(!v)return;syncing.current=true;try{const before=v.state.doc.toString();v.dispatch({...(before!==props.value?{changes:replacement(before,props.value)}:{}),effects:showMarkdown.of(!!props.source)});}finally{syncing.current=false;}},[props.value,props.source]);
  return <><div className={`markdown-field ${props.className??''}`} ref={host}/>{menu&&<TextMenu x={menu.x} y={menu.y} onFormat={(format,href)=>applyFormat(view.current!,format,href)} onClose={restore=>{setMenu(null);if(restore)view.current?.focus();}}/>}</>;
}
