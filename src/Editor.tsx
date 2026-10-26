import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { EditorState, StateEffect, StateField, ChangeSet, Prec } from '@codemirror/state';
import { EditorView, Decoration, keymap, placeholder, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { type Draft, type Span, type Cut, overlaps, contains } from './model';

type Annotations={draft:Draft;active:string|null;cuts:Cut[]};
const annotate=StateEffect.define<Annotations>();
const decorations=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update(value,tr){
    const effect=tr.effects.find(e=>e.is(annotate));
    if(!effect)return value.map(tr.changes);
    const {draft:d,active,cuts}=effect.value as Annotations;
    const marks=[];
    if(d.text.length)marks.push(Decoration.line({class:'opening-line'}).range(0));
    if(d.revisionMode){
      for(const v of d.variants)marks.push(Decoration.mark({class:`variant ${v.active?'variant-chosen':''} ${v.id===active?'variant-focused':''}`,attributes:{'data-variant':v.id,title:`${v.candidates.length+1} wordings · click to compare`}}).range(v.from,v.to));
      for(const g of d.ghosts)marks.push(Decoration.mark({class:'ghost-text',attributes:{'data-ghost':g.id,'aria-label':'Set aside. Click Revive in the side panel to restore.',title:'Set aside — hover to read at full contrast'}}).range(g.from,g.to));
    }else{
      for(const g of d.ghosts)marks.push(Decoration.replace({}).range(g.from,g.to));
    }
    for(const c of cuts)if(c.accepted)marks.push(Decoration.mark({class:'cut-preview',attributes:{title:c.reason}}).range(c.from,c.to));
    return Decoration.set(marks,true);
  },
  provide:field=>EditorView.decorations.from(field)
});
export type EditorHandle={focus:()=>void;select:(range:Span)=>void};
type Props={draft:Draft;active:string|null;cuts:Cut[];onChange:(changes:ChangeSet)=>void;onSelection:(range:Span)=>void;onVariant:(id:string)=>void;onError:(message:string)=>void;onAction:(action:string)=>void};
export const Editor=forwardRef<EditorHandle,Props>(function Editor(props,ref){
  const host=useRef<HTMLDivElement>(null), view=useRef<EditorView|null>(null), current=useRef(props), syncing=useRef(false);
  current.current=props;
  useImperativeHandle(ref,()=>({focus:()=>view.current?.focus(),select:r=>{view.current?.dispatch({selection:{anchor:r.from,head:r.to},scrollIntoView:true});view.current?.focus();}}));
  useEffect(()=>{
    const v=new EditorView({parent:host.current!,state:EditorState.create({doc:current.current.draft.text,extensions:[
      decorations, EditorView.lineWrapping, placeholder('Start writing…'),drawSelection({drawRangeCursor:false}),
      EditorView.contentAttributes.of({'aria-label':'Draft body','spellcheck':'true','autocapitalize':'sentences'}),
      Prec.highest(keymap.of([
        {key:'Mod-z',run:()=>{current.current.onAction('undo');return true;}},
        {key:'Mod-Shift-z',run:()=>{current.current.onAction('redo');return true;}},
        {key:'Mod-Shift-a',run:()=>{current.current.onAction('alternative');return true;}},
        {key:'Mod-Shift-g',run:()=>{current.current.onAction('ghost');return true;}},
        {key:'Mod-Shift-o',run:()=>{current.current.onAction('overflow');return true;}},
      ])),keymap.of(defaultKeymap),
      EditorState.transactionFilter.of(tr=>{
        if(syncing.current||!tr.docChanged)return tr;
        const d=current.current.draft;let invalid=false;
        tr.changes.iterChangedRanges((from,to)=>{if(from===to)return;for(const v of d.variants){const r={from,to};if(overlaps(r,v)&&!contains(v,r)&&!contains(r,v))invalid=true;}});
        if(invalid){queueMicrotask(()=>current.current.onError('This edit would split an alternative. Select the whole marked passage, or edit within it.'));return [];}
        return tr;
      }),
      EditorView.updateListener.of(update=>{
        if(syncing.current)return;
        if(update.docChanged)current.current.onChange(update.changes);
        if(update.selectionSet||update.docChanged){const {from,to}=update.state.selection.main;current.current.onSelection({from,to});}
      }),
      EditorView.domEventHandlers({click:(event)=>{const el=(event.target as HTMLElement).closest('[data-variant]');if(el)current.current.onVariant(el.getAttribute('data-variant')!);return false;}}),
    ]})});view.current=v;
    return ()=>{v.destroy();view.current=null;};
  },[annotate]);
  useEffect(()=>{
    const v=view.current;if(!v)return;
    syncing.current=true;
    try {
      const different=v.state.doc.toString()!==props.draft.text;
      v.dispatch({...(different?{changes:{from:0,to:v.state.doc.length,insert:props.draft.text},selection:{anchor:Math.min(v.state.selection.main.from,props.draft.text.length)}}:{}),effects:annotate.of({draft:props.draft,active:props.active,cuts:props.cuts})});
      if(different){const {from,to}=v.state.selection.main;props.onSelection({from,to});}
    }finally{syncing.current=false;}
  },[props.draft,props.active,props.cuts,annotate]);
  return <div className="editor-host" ref={host}/>;
});
