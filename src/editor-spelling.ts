import {StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,type DecorationSet} from '@codemirror/view';
import {api} from './client';
import {markdownParser} from './markdown';

export type SpellingWord={from:number;to:number;word:string};
const checked=StateEffect.define<SpellingWord[]>();
const spellingState=StateField.define<{words:SpellingWord[];marks:DecorationSet}>({
  create:()=>({words:[],marks:Decoration.none}),
  update(value,tr){
    const result=tr.effects.find(effect=>effect.is(checked));
    if(result){const words=result.value;return {words,marks:Decoration.set(words.map(word=>Decoration.mark({class:'spelling-word','attributes':{'data-spelling':word.word}}).range(word.from,word.to)),true)};}
    if(!tr.docChanged)return value;
    const words=value.words.flatMap(word=>{
      let touched=false;tr.changes.iterChangedRanges((from,to)=>{if(from<=word.to&&to>=word.from)touched=true;});
      return touched?[]:[{...word,from:tr.changes.mapPos(word.from,1),to:tr.changes.mapPos(word.to,-1)}];
    });
    return {words,marks:Decoration.set(words.map(word=>Decoration.mark({class:'spelling-word',attributes:{'data-spelling':word.word}}).range(word.from,word.to)),true)};
  },
  provide:field=>EditorView.decorations.from(field,value=>value.marks),
});

// Keep UTF-16 positions intact while excluding Markdown code and link destinations.
export function spellingText(text:string){
  const excluded:{from:number;to:number}[]=[];
  markdownParser.parse(text).iterate({enter(node){
    if(['FencedCode','CodeBlock','InlineCode','URL','HTMLTag'].includes(node.name)){excluded.push({from:node.from,to:node.to});return false;}
  }});
  return excluded.sort((a,b)=>b.from-a.from).reduce((value,range)=>value.slice(0,range.from)+value.slice(range.from,range.to).replace(/[^\n]/g,' ')+value.slice(range.to),text);
}

const spellingPlugin=ViewPlugin.define(view=>{
  let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,closed=false,unavailable=false;
  const schedule=()=>{
    if(unavailable)return;
    clearTimeout(timer);controller?.abort();
    timer=setTimeout(async()=>{
      if(view.composing){schedule();return;}
      const doc=view.state.doc;
      // Very long documents are checked around the visible writing, not on every page.
      const from=doc.length>200000?doc.lineAt(view.viewport.from).from:0,to=Math.min(doc.length,from+200000);
      const text=spellingText(doc.sliceString(from,to));
      if(!text.trim()){view.dispatch({effects:checked.of([])});return;}
      const abort=new AbortController();controller=abort;
      try{
        const result=await api<{available?:boolean;words:SpellingWord[]}>('/api/spelling',{text},abort.signal);
        if(closed||abort.signal.aborted||view.state.doc!==doc)return;
        if(result.available===false){unavailable=true;return;}
        const words=result.words.filter(word=>Number.isInteger(word.from)&&Number.isInteger(word.to)&&word.from>=0&&word.to>word.from&&word.to<=text.length&&text.slice(word.from,word.to)===word.word).map(word=>({...word,from:word.from+from,to:word.to+from}));
        view.dispatch({effects:checked.of(words)});
      }catch{ /* Native browser spelling remains available outside the Mac app. */ }
    },500);
  };
  schedule();return {update(update){if(update.docChanged||update.viewportChanged)schedule();},destroy(){closed=true;clearTimeout(timer);controller?.abort();}};
});
export const nativeSpelling=[spellingState,spellingPlugin];
export function spellingAt(view:EditorView,event:MouseEvent){
  const point=view.posAtCoords({x:event.clientX,y:event.clientY});
  return point===null?undefined:view.state.field(spellingState,false)?.words.find(word=>point>=word.from&&point<word.to);
}
export function correctSpelling(view:EditorView,word:SpellingWord,replacement:string){
  if(view.state.doc.sliceString(word.from,word.to)!==word.word)return;
  view.dispatch({changes:{from:word.from,to:word.to,insert:replacement},selection:{anchor:word.from+replacement.length},userEvent:'input.spelling'});view.focus();
}
