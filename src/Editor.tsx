import {useEffect,useRef,useState,forwardRef,useImperativeHandle} from 'react';
import {createPortal} from 'react-dom';
import {EditorState,Prec,type Extension} from '@codemirror/state';
import {EditorView,keymap,drawSelection,dropCursor,ViewPlugin,Decoration} from '@codemirror/view';
import {defaultKeymap,history,historyField,undo,redo,undoDepth,redoDepth} from '@codemirror/commands';
import type {Span} from './model';
import {formatMarkdown,type TextFormat} from './markdown';
import {markdownEditing,showMarkdown,draftMedia} from './editor-markdown';
import {TextMenu} from './TextMenu';
import {nativeSpelling,spellingAt,correctSpelling,type SpellingWord} from './editor-spelling';
import {pastedImage} from './images';
import {ImageMenu} from './ImageEditor';
import {api} from './client';

// The highlight, as a mark on the selected text. WebKit's own highlight fills the whole 1.9 line
// height; a mark's background covers only the height of the letters, at any text size.
const selectedMark=Decoration.mark({class:'cm-selected-text'});
const selectedText=EditorView.decorations.compute(['selection'],state=>Decoration.set(state.selection.ranges.filter(r=>!r.empty).map(r=>selectedMark.range(r.from,r.to))));

export type EditorHandle={focus:()=>void;select:(range:Span)=>void;undo:()=>void;redo:()=>void;depth:()=>HistoryDepth};
export type HistoryDepth={undo:number;redo:number};
type Props={draftId:string;versionId:string;text:string;source?:boolean;autoFocus?:boolean;onChange:(text:string)=>void;onFocus?:()=>void;onSelection?:(text:string)=>void;onHistory?:(depth:HistoryDepth)=>void;onError:(message:string)=>void;selectedImage?:Span|null;onImagePaste?:(image:File,at:Span)=>void;onImageCopy?:(src:string)=>void;onImageSelect?:(pos:number)=>void};

// Each version column scrolls on its own.
const scrollArea=(view:EditorView)=>view.dom.closest<HTMLElement>('.version-scroll')??view.dom.closest<HTMLElement>('.writing-area');
const writingScrollRoom=ViewPlugin.define(view=>{
  const area=scrollArea(view);if(!area)return {};
  const measure=()=>{if(area.clientHeight)area.style.setProperty('--writing-room',`${Math.max(0,area.clientHeight-32)}px`);};
  const observer=new ResizeObserver(measure);observer.observe(area);measure();
  return {destroy(){observer.disconnect();area.style.removeProperty('--writing-room');}};
});
function replacement(before:string,after:string){let from=0,oldTo=before.length,newTo=after.length;while(from<oldTo&&from<newTo&&before[from]===after[from])from++;while(oldTo>from&&newTo>from&&before[oldTo-1]===after[newTo-1]){oldTo--;newTo--;}return {from,to:oldTo,insert:after.slice(from,newTo)};}
function selectContext(view:EditorView,event:MouseEvent):Span {
  const point=view.posAtCoords({x:event.clientX,y:event.clientY}),selection=view.state.selection.main;
  if(point===null)return selection;
  if(!selection.empty&&point>=selection.from&&point<=selection.to)return selection;
  const range=view.state.wordAt(point)??{from:point,to:point};view.dispatch({selection:{anchor:range.from,head:range.to}});return range;
}
function applyFormat(view:EditorView,format:TextFormat,href?:string){const edit=formatMarkdown(view.state.doc.toString(),view.state.selection.main,format,href);view.dispatch({changes:{from:edit.from,to:edit.to,insert:edit.insert},selection:{anchor:edit.selection.from,head:edit.selection.to},userEvent:'input.format'});view.focus();}

// Every version keeps its own editor state, so undo and redo stay with the version
// while you switch drafts. The history is also saved in the draft's package.
const states=new Map<string,EditorState>();
// Where you were scrolled to in each version, so switching back returns to the same place.
const scrolls=new Map<string,number>();
const key=(draftId:string,versionId:string)=>`${draftId}/${versionId}`;
type SavedHistory={doc:string;selection:unknown;history:unknown};
async function restore(draftId:string,versionId:string,text:string,extensions:Extension[]):Promise<EditorState>{
  const cached=states.get(key(draftId,versionId));if(cached)return cached;
  try{
    const {history:saved}=await api<{history:SavedHistory|null}>('/api/drafts/history/load',{id:draftId,versionId});
    // History only applies to the exact text it was recorded against.
    if(saved?.doc===text)return EditorState.fromJSON(saved,{extensions},{history:historyField});
  }catch{}
  return EditorState.create({doc:text,extensions});
}
const pendingHistory=new Map<string,ReturnType<typeof setTimeout>>();
function saveHistory(draftId:string,versionId:string,state:EditorState,delay=1200){
  const id=key(draftId,versionId);clearTimeout(pendingHistory.get(id));
  pendingHistory.set(id,setTimeout(()=>{pendingHistory.delete(id);void api('/api/drafts/history',{id:draftId,versionId,history:state.toJSON({history:historyField})}).catch(()=>{});},delay));
}

export const Editor=forwardRef<EditorHandle,Props>(function Editor(props,ref){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),current=useRef(props),syncing=useRef(false),shown=useRef(key(props.draftId,props.versionId)),restored=useRef(false);
  const [menu,setMenu]=useState<{x:number;y:number;range:Span;spelling?:SpellingWord}|null>(null),[imageMenu,setImageMenu]=useState<{x:number;y:number;src:string}|null>(null);current.current=props;
  const report=(state:EditorState)=>current.current.onHistory?.({undo:undoDepth(state),redo:redoDepth(state)});
  useImperativeHandle(ref,()=>({
    focus:()=>view.current?.focus(),
    select:r=>{view.current?.dispatch({selection:{anchor:r.from,head:r.to},scrollIntoView:true});view.current?.focus();},
    undo:()=>{if(view.current){undo(view.current);view.current.focus();}},
    redo:()=>{if(view.current){redo(view.current);view.current.focus();}},
    depth:()=>view.current?{undo:undoDepth(view.current.state),redo:redoDepth(view.current.state)}:{undo:0,redo:0},
  }));
  const extensions=(draftId:string):Extension[]=>[
    markdownEditing,nativeSpelling,writingScrollRoom,history(),draftMedia.of(draftId),EditorView.lineWrapping,// The editor draws the caret at the height of the text, and the highlight is painted on the
    // selected text itself (see .cm-selected-text in writing.css), so it is as tall as the letters
    // rather than the whole line.
    drawSelection({drawRangeCursor:false}),selectedText,
    // While dragging text, a blinking cursor shows where it will land.
    dropCursor(),
    // Keep the caret clear of the glass tab floating over the top of the text.
    EditorView.scrollMargins.of(()=>({top:56,bottom:24})),
    EditorView.contentAttributes.of({'aria-label':'Draft body',role:'textbox','aria-multiline':'true',spellcheck:'true',autocapitalize:'sentences'}),
    Prec.highest(keymap.of([
      {key:'Mod-z',run:undo,preventDefault:true},{key:'Mod-Shift-z',run:redo,preventDefault:true},{key:'Mod-y',run:redo,preventDefault:true},
      // ⌘B shows and hides the sidebar, so bold lives in the right-click menu.
      ...(['i','u'] as const).map((key,i)=>({key:`Mod-${key}`,run:(editor:EditorView)=>{try{applyFormat(editor,(['italic','underline'] as const)[i]);}catch(e){current.current.onError((e as Error).message);}return true;}})),
    ])),keymap.of(defaultKeymap),
    EditorView.updateListener.of(update=>{
      // While another version's state is loading, edits still belong to the version on screen.
      const p=current.current,[draftId,versionId]=shown.current.split('/');if(restored.current)states.set(shown.current,update.state);
      if(update.docChanged){saveHistory(draftId,versionId,update.state);if(!syncing.current&&shown.current===key(p.draftId,p.versionId))p.onChange(update.state.doc.toString());}
      // The selected text, for counting the words you have highlighted.
      if(update.selectionSet||update.docChanged)p.onSelection?.(update.state.selection.ranges.map(r=>update.state.sliceDoc(r.from,r.to)).filter(Boolean).join('\n'));
      report(update.state);
    }),
    EditorView.domEventHandlers({
      focus:()=>{current.current.onFocus?.();return false;},
      mousedown:(event,editor)=>{const image=(event.target as HTMLElement).closest<HTMLElement>('[data-image-src]');if(event.button===0&&image&&current.current.onImageSelect){current.current.onImageSelect(editor.posAtDOM(image));return false;}return false;},
      paste:(event,editor)=>{const image=pastedImage(event.clipboardData);if(!image||!current.current.onImagePaste)return false;event.preventDefault();const {from,to}=editor.state.selection.main;current.current.onImagePaste(image,{from,to});return true;},
      contextmenu:(event,editor)=>{event.preventDefault();const image=(event.target as HTMLElement).closest<HTMLElement>('[data-image-src]');if(image&&current.current.onImageCopy){setMenu(null);setImageMenu({x:event.clientX,y:event.clientY,src:image.dataset.imageSrc!});return true;}const spelling=spellingAt(editor,event),range=selectContext(editor,event);setMenu({x:event.clientX,y:event.clientY,range,spelling});return true;},
    }),
  ];
  useEffect(()=>{
    const v=new EditorView({parent:host.current!,state:EditorState.create({doc:props.text,extensions:extensions(props.draftId)})});view.current=v;
    const area=scrollArea(v),remember=()=>{if(restored.current&&area)scrolls.set(shown.current,area.scrollTop);};area?.addEventListener('scroll',remember,{passive:true});
    return()=>{area?.removeEventListener('scroll',remember);if(restored.current)states.set(shown.current,v.state);v.destroy();view.current=null;};
  },[]);
  // Switching versions swaps in that version's own state and history.
  useEffect(()=>{
    const v=view.current;if(!v)return;const id=key(props.draftId,props.versionId);let live=true;
    if(restored.current&&shown.current!==id)states.set(shown.current,v.state);
    restored.current=false;
    void restore(props.draftId,props.versionId,current.current.text,extensions(props.draftId)).then(state=>{
      if(!live||!view.current)return;
      const text=current.current.text;
      syncing.current=true;try{v.setState(state);shown.current=id;restored.current=true;if(state.doc.toString()!==text)v.dispatch({changes:replacement(state.doc.toString(),text)});v.dispatch({effects:showMarkdown.of(!!current.current.source)});}finally{syncing.current=false;}
      // The page scrolls outside the editor; a version you have not scrolled yet starts at the top.
      const area=scrollArea(v),top=scrolls.get(id)??0;if(area){area.scrollTop=top;requestAnimationFrame(()=>{if(shown.current===id&&Math.abs(area.scrollTop-top)>1)area.scrollTop=top;});}
      states.set(id,v.state);report(v.state);if(current.current.autoFocus)v.focus();
    });
    return()=>{live=false;};
  },[props.draftId,props.versionId]);
  // Changes made outside the editor, such as an image or crop, are undoable like typing.
  useEffect(()=>{
    const v=view.current;if(!v||shown.current!==key(props.draftId,props.versionId))return;syncing.current=true;
    try{const before=v.state.doc.toString();v.dispatch({...(before!==props.text?{changes:replacement(before,props.text)}:{}),effects:showMarkdown.of(!!props.source)});}finally{syncing.current=false;}
  },[props.text,props.source]);
  useEffect(()=>{
    const v=view.current;if(!v)return;
    const mark=()=>{for(const frame of v.contentDOM.querySelectorAll<HTMLElement>('[data-image-src]')){const pos=v.posAtDOM(frame),selected=props.selectedImage;frame.classList.toggle('is-selected',!!selected&&pos>=selected.from&&pos<=selected.to);}};
    mark();const frame=requestAnimationFrame(mark);return()=>cancelAnimationFrame(frame);
  },[props.selectedImage?.from,props.selectedImage?.to,props.text]);
  // The menus render at the top of the page, so the text area's fade mask and clipping can
  // never hide or misplace them (WebKit positions fixed elements inside a masked scroller oddly).
  return <><div className="editor-host" ref={host}/>{createPortal(<>{menu&&<TextMenu x={menu.x} y={menu.y} spelling={menu.spelling} onSpellingFix={text=>menu.spelling&&correctSpelling(view.current!,menu.spelling,text)} onFormat={(format,href)=>applyFormat(view.current!,format,href)} onClose={restore=>{setMenu(null);if(restore)view.current?.focus();}}/>}{imageMenu&&<ImageMenu x={imageMenu.x} y={imageMenu.y} onCopy={()=>props.onImageCopy?.(imageMenu.src)} onClose={restore=>{setImageMenu(null);if(restore)view.current?.focus();}}/>}</>,document.body)}</>;
});
