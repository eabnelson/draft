import {StateField,Prec,EditorState} from '@codemirror/state';
import {Decoration,EditorView,keymap,hoverTooltip,activateHover,closeHoverTooltips,hasHoverTooltips} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import {markdownLinks,unlinkMarkdown,cleanupLinkChanges,type MarkdownLink} from './links';
import {openLink} from './client';

export function linkEditing(sourceMode:StateField<boolean>){
  function read(state:EditorState){
    const links=markdownLinks(state.doc.toString(),syntaxTree(state)),ranges=[],hidden=[];
    for(const link of links){
      if(link.labelTo>link.labelFrom)ranges.push(Decoration.mark({class:'md-link',attributes:{'data-link-from':String(link.from)}}).range(state.field(sourceMode)?link.from:link.labelFrom,state.field(sourceMode)?link.to:link.labelTo));
      hidden.push(Decoration.replace({}).range(link.from,link.labelFrom),Decoration.replace({}).range(link.labelTo,link.to));
    }
    const atomic=Decoration.set(hidden,true);
    return {links,atomic,marks:Decoration.set(state.field(sourceMode)?ranges:[...ranges,...hidden],true)};
  }
  const data=StateField.define({create:read,update:(value,tr)=>tr.docChanged||syntaxTree(tr.startState)!==syntaxTree(tr.state)||tr.startState.field(sourceMode)!==tr.state.field(sourceMode)?read(tr.state):value,provide:field=>[EditorView.decorations.from(field,value=>value.marks),EditorView.atomicRanges.of(view=>view.state.field(sourceMode)?Decoration.none:view.state.field(field).atomic)]});
  function unlink(view:EditorView,link:MarkdownLink){
    const edit=unlinkMarkdown(view.state.doc.toString(),link,view.state.selection.main.head);
    view.dispatch({changes:edit.changes,selection:{anchor:edit.selection.from},effects:closeHoverTooltips,userEvent:'input.format'});view.focus();return true;
  }
  function removeAtBoundary(view:EditorView,backward:boolean){
    if(view.state.field(sourceMode)||view.composing||!view.state.selection.main.empty)return false;
    const pos=view.state.selection.main.head,link=view.state.field(data).links.find(l=>backward?pos>=l.labelTo&&pos<=l.to||pos===l.labelFrom:pos>=l.from&&pos<=l.labelFrom||pos===l.labelTo);
    return link?unlink(view,link):false;
  }
  function continueWriting(view:EditorView,link:MarkdownLink){view.dispatch({selection:{anchor:link.to},effects:closeHoverTooltips});view.focus();}
  const tooltip=hoverTooltip((view,pos,side)=>{
    if(view.state.field(sourceMode))return null;
    const link=view.state.field(data).links.find(l=>pos>=l.labelFrom&&pos<=l.labelTo&&!(pos===l.labelFrom&&side<0)&&!(pos===l.labelTo&&side>0));if(!link)return null;
    return {pos:link.labelFrom,end:link.labelTo,above:true,arrow:true,create(){
      const dom=document.createElement('div');dom.className='link-tooltip';dom.setAttribute('role','dialog');dom.setAttribute('aria-label','Link options');
      if(link.url){
        const anchor=document.createElement('a');anchor.href=link.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=link.url;anchor.setAttribute('aria-label',`Open ${link.url}`);
        anchor.addEventListener('click',event=>{event.preventDefault();void openLink(link.url!).catch(()=>{const message=document.createElement('span');message.className='link-error';message.setAttribute('role','alert');message.textContent='Couldn’t open this link.';dom.append(message);});});dom.append(anchor);
      }else {const label=document.createElement('span');label.textContent=link.destination||'Link';dom.append(label);}
      const actions=document.createElement('div');actions.className='link-tooltip-actions';
      for(const [label,action] of [['Remove link',()=>unlink(view,link)],['Continue writing',()=>continueWriting(view,link)]] as const){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);actions.append(button);}dom.append(actions);
      dom.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();view.dispatch({effects:closeHoverTooltips});view.focus();}});
      return {dom};
    }};
  },{hoverTime:200,hideOnChange:true});
  return [
    data,
    Prec.highest(keymap.of([
      {key:'Backspace',run:view=>removeAtBoundary(view,true)},
      {key:'Delete',run:view=>removeAtBoundary(view,false)},
      {key:'Enter',run:view=>{if(view.state.field(sourceMode)||!view.state.selection.main.empty)return false;const link=view.state.field(data).links.find(l=>l.labelTo===view.state.selection.main.head);if(!link)return false;view.dispatch({changes:{from:link.to,insert:'\n'},selection:{anchor:link.to+1},userEvent:'input'});return true;}},
      {key:'Escape',run:view=>{if(!hasHoverTooltips(view.state))return false;view.dispatch({effects:closeHoverTooltips});return true;}},
    ])),
    EditorView.inputHandler.of((view,from,to,text)=>{if(view.state.field(sourceMode)||view.composing||from!==to||!/^\s+$/.test(text))return false;const link=view.state.field(data).links.find(l=>l.labelTo===from);if(!link)return false;view.dispatch({changes:{from:link.to,insert:text},selection:{anchor:link.to+text.length},userEvent:'input.type'});return true;}),
    EditorState.transactionFilter.of(tr=>{
      if(!tr.docChanged||tr.startState.field(sourceMode)||tr.isUserEvent('input.format')||tr.isUserEvent('input.type.compose')||!tr.isUserEvent('delete')&&!tr.isUserEvent('input'))return tr;
      const cleanup=cleanupLinkChanges(tr.startState.doc.toString(),tr.changes,tr.startState.field(data).links);
      return cleanup?[tr,{changes:cleanup,selection:tr.newSelection.map(cleanup),sequential:true}]:tr;
    }),
    tooltip,
    EditorView.domEventHandlers({click(event,view){const target=(event.target as HTMLElement).closest<HTMLElement>('[data-link-from]');if(target){const link=view.state.field(data).links.find(l=>l.from===Number(target.dataset.linkFrom));if(link)activateHover(view,link.labelFrom,1,{tooltip,until:tr=>tr.docChanged||!!tr.selection});}return false;}}),
  ];
}
