import {StateField,StateEffect,type EditorState,type Range} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,type DecorationSet} from '@codemirror/view';
import {Language,defineLanguageFacet,languageDataProp,syntaxTree} from '@codemirror/language';
import {markdownParser} from './markdown';
import {linkEditing} from './editor-links';
import {safeImageSource} from './images';

export const showMarkdown=StateEffect.define<boolean>();
const sourceMode=StateField.define({create:()=>false,update:(value,tr)=>tr.effects.find(e=>e.is(showMarkdown))?.value as boolean??value});
function render(state:EditorState):DecorationSet {
  const marks=[],source=state.field(sourceMode),text=state.doc.toString();
  syntaxTree(state).iterate({enter(node){
    const heading=/^ATXHeading([1-6])$/.exec(node.name);
    if(heading)marks.push(Decoration.line({class:`md-heading md-h${heading[1]}`}).range(node.from));
    const cls=({StrongEmphasis:'md-bold',Emphasis:'md-italic',Strikethrough:'md-strike',InlineCode:'md-code',FencedCode:'md-code-block',Blockquote:'md-quote'} as Record<string,string>)[node.name];
    if(cls)marks.push(Decoration.mark({class:cls}).range(node.from,node.to));
    if(!source&&['EmphasisMark','StrikethroughMark','HeaderMark','CodeMark','QuoteMark'].includes(node.name)){let to=node.to;if(node.name==='HeaderMark')while(to<text.length&&/[ \t]/.test(text[to]))to++;marks.push(Decoration.replace({}).range(node.from,to));}
  }});
  for(const match of text.matchAll(/<u>([^]*?)<\/u>/g)){
    if(match[1])marks.push(Decoration.mark({class:'md-underline'}).range(match.index+3,match.index+3+match[1].length));
    if(!source){marks.push(Decoration.replace({}).range(match.index,match.index+3));marks.push(Decoration.replace({}).range(match.index+3+match[1].length,match.index+match[0].length));}
  }
  return Decoration.set(marks,true);
}
const markdownMarks=StateField.define<DecorationSet>({create:render,update:(value,tr)=>tr.docChanged||syntaxTree(tr.startState)!==syntaxTree(tr.state)||tr.startState.field(sourceMode)!==tr.state.field(sourceMode)?render(tr.state):value.map(tr.changes),provide:field=>EditorView.decorations.from(field)});
class ImageWidget extends WidgetType {
  constructor(readonly src:string,readonly alt:string){super();}
  eq(other:ImageWidget){return other.src===this.src&&other.alt===this.alt;}
  toDOM(view:EditorView){
    const frame=document.createElement('span'),image=document.createElement('img');
    frame.className='md-image';frame.dataset.imageSrc=this.src;frame.title='Right-click to copy this image';
    image.src=this.src;image.alt=this.alt;image.draggable=false;image.decoding='async';
    // Wrapped lines below an image move once its real height is known.
    image.addEventListener('load',()=>view.requestMeasure());image.addEventListener('error',()=>{frame.classList.add('is-missing');frame.dataset.missing='Image unavailable';});
    frame.append(image);return frame;
  }
  ignoreEvent(){return false;}
}
function images(state:EditorState):DecorationSet {
  if(state.field(sourceMode))return Decoration.none;
  const marks:Range<Decoration>[]=[],text=state.doc.toString();
  syntaxTree(state).iterate({enter(node){
    if(node.name!=='Image')return;
    const url=node.node.getChild('URL'),close=node.node.getChildren('LinkMark').find(mark=>text.slice(mark.from,mark.to)===']');
    const src=url?text.slice(url.from,url.to):'';
    if(safeImageSource(src))marks.push(Decoration.replace({widget:new ImageWidget(src,close?text.slice(node.from+2,close.from):'')}).range(node.from,node.to));
    return false;
  }});
  return Decoration.set(marks,true);
}
// One keystroke moves past or deletes a whole image, never part of its Markdown.
const imageMarks=StateField.define<DecorationSet>({create:images,update:(value,tr)=>tr.docChanged||syntaxTree(tr.startState)!==syntaxTree(tr.state)||tr.startState.field(sourceMode)!==tr.state.field(sourceMode)?images(tr.state):value.map(tr.changes),provide:field=>[EditorView.decorations.from(field),EditorView.atomicRanges.of(view=>view.state.field(field))]});
const data=defineLanguageFacet();
const language=new Language(data,markdownParser.configure({props:[languageDataProp.add({Document:data})]}),[],'markdown');
export const markdownEditing=[language,sourceMode,markdownMarks,imageMarks,linkEditing(sourceMode)];
