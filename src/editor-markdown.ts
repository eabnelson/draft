import {StateField,StateEffect,type EditorState} from '@codemirror/state';
import {Decoration,EditorView,type DecorationSet} from '@codemirror/view';
import {Language,defineLanguageFacet,languageDataProp,syntaxTree} from '@codemirror/language';
import {markdownParser} from './markdown';
import {linkEditing} from './editor-links';

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
const data=defineLanguageFacet();
const language=new Language(data,markdownParser.configure({props:[languageDataProp.add({Document:data})]}),[],'markdown');
export const markdownEditing=[language,sourceMode,markdownMarks,linkEditing(sourceMode)];
