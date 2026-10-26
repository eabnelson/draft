import {EditorView,drawSelection} from '@codemirror/view';
import {StateEffect} from '@codemirror/state';
import type {DemoStore} from './store';

const sample='Good writing needs room.\n\nA first draft is a place to begin. Try a different word. Give an idea a little room to breathe.\n\nThis thought can wait while the rest of the piece finds its shape.\n\nA note for another day.';
const ease=(t:number)=>t*t*(3-2*t);
type Point={x:number;y:number};
type Caret={left:number;top:number;bottom:number};

export class Tour{
  private controller?:AbortController;
  private paused=false;
  private scene='Write';
  private headline='Write your first draft.';
  private position:Point={x:80,y:40};
  private target?:HTMLElement;
  private typingCaret?:HTMLElement;
  private decorated=new WeakSet<EditorView>();
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(private store:DemoStore,private reset:()=>void){}
  private announce(){window.dispatchEvent(new CustomEvent('draft-demo-scene',{detail:{scene:this.scene,headline:this.headline,state:this.paused?'paused':'playing'}}));}
  private pointer(kind:string,point?:Point){window.dispatchEvent(new CustomEvent('draft-demo-pointer',{detail:{kind,...point}}));}
  pause(){if(!this.controller)return;this.paused=true;if(this.typingCaret)this.typingCaret.style.animationPlayState='paused';this.store.setPaused(true);this.announce();}
  play(){
    if(this.controller){this.paused=false;if(this.typingCaret)this.typingCaret.style.animationPlayState='running';this.store.setPaused(false);this.announce();return;}
    this.paused=false;this.store.setPaused(false);
    const controller=new AbortController();this.controller=controller;
    void this.loop(controller.signal).catch(error=>{if(!controller.signal.aborted){console.error(error);this.controller=undefined;this.paused=true;this.store.setPaused(true);this.headline='Replay the walkthrough.';this.pointer('hide');this.announce();document.getElementById('root')!.style.opacity='1';}});
  }
  replay(autoplay=true){this.controller?.abort();this.controller=undefined;this.pointer('reset');this.mark();if(autoplay)this.play();else{this.paused=true;this.store.setPaused(true);this.reset();document.getElementById('root')!.style.opacity='1';this.scene='Write';this.headline='Write your first draft.';this.announce();}}
  private get mobile(){return window.innerWidth<=900;}
  private animate(duration:number,update:(progress:number)=>void,signal:AbortSignal){
    return new Promise<void>((resolve,reject)=>{
      if(signal.aborted){reject(signal.reason);return;}
      let elapsed=0,last=performance.now(),frame=0;
      const abort=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',abort);reject(signal.reason);};
      const tick=(now:number)=>{
        const delta=Math.min(48,now-last);last=now;
        if(!this.paused){elapsed+=delta;const progress=duration?Math.min(1,elapsed/duration):1;update(progress);if(progress===1){signal.removeEventListener('abort',abort);resolve();return;}}
        frame=requestAnimationFrame(tick);
      };
      signal.addEventListener('abort',abort,{once:true});frame=requestAnimationFrame(tick);
    });
  }
  private wait(ms:number,signal:AbortSignal){return this.animate(ms,()=>{},signal);}
  private async step(scene:string,headline:string,signal:AbortSignal){this.scene=scene;this.headline=headline;this.announce();await this.wait(650,signal);}
  private async until(check:()=>boolean,signal:AbortSignal,limit=12000){for(let elapsed=0;elapsed<limit;elapsed+=120){if(check())return;await this.wait(120,signal);}throw Error('The walkthrough could not reach its next step.');}
  private async move(point:Point,signal:AbortSignal,duration=850,curve=true,onProgress?:(progress:number)=>void){
    const from={...this.position},dx=point.x-from.x,dy=point.y-from.y,arc=curve?Math.min(18,Math.hypot(dx,dy)*.025):0;
    await this.animate(this.reduced?0:duration,t=>{const p=ease(t);this.position={x:from.x+dx*p,y:from.y+dy*p-Math.sin(Math.PI*p)*arc};this.pointer('move',this.position);onProgress?.(p);},signal);
  }
  private mark(element?:HTMLElement){this.target?.classList.remove('tour-target');this.target=element;element?.classList.add('tour-target');}
  private async reveal(element:HTMLElement,signal:AbortSignal){
    if(element.closest('.features-top'))return;
    for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      if(!['auto','scroll'].includes(getComputedStyle(parent).overflowY)||parent.scrollHeight<=parent.clientHeight)continue;
      const bounds=parent.getBoundingClientRect(),rect=element.getBoundingClientRect(),inset=parent.classList.contains('features-page')?62:20;
      let destination=parent.scrollTop;
      if(rect.top<bounds.top+inset)destination+=rect.top-bounds.top-inset;
      else if(rect.bottom>bounds.bottom-20)destination+=rect.bottom-bounds.bottom+20;
      destination=Math.max(0,Math.min(parent.scrollHeight-parent.clientHeight,destination));
      const start=parent.scrollTop,scroller=parent;
      if(Math.abs(destination-start)>2)await this.animate(this.reduced?0:900,t=>{scroller.scrollTop=start+(destination-start)*ease(t);},signal);
    }
  }
  private center(element:Element):Point{const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}
  private async pointAt(element:HTMLElement,signal:AbortSignal){await this.reveal(element,signal);this.mark(element);await this.move(this.center(element),signal);await this.wait(200,signal);}
  private findButton(names:string|string[]){const labels=Array.isArray(names)?names:[names];return [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getClientRects().length&&labels.some(text=>b.textContent?.trim()===text||b.getAttribute('aria-label')===text));}
  private async fade(opacity:number,signal:AbortSignal){const root=document.getElementById('root')!,start=Number(getComputedStyle(root).opacity);await this.animate(this.reduced?0:280,p=>{root.style.opacity=String(start+(opacity-start)*ease(p));},signal);}
  private async click(names:string|string[],signal:AbortSignal,transition=false){
    const button=this.findButton(names);if(!button||button.disabled)throw Error(`The walkthrough control is unavailable: ${names}`);
    await this.pointAt(button,signal);this.pointer('press');button.classList.add('tour-pressed');await this.wait(150,signal);
    if(transition)await this.fade(0,signal);
    button.click();this.pointer('release');button.classList.remove('tour-pressed');this.mark();
    await this.wait(transition?180:260,signal);if(transition)await this.fade(1,signal);
    await this.wait(400,signal);
  }
  private async mobilePanel(open:boolean,signal:AbortSignal){if(!this.mobile)return;const label=open?'Open side panel':'Close side panel';if(this.findButton(label))await this.click(label,signal,true);}
  private editorBounds(view:EditorView){const scroller=view.dom.closest<HTMLElement>('.writing-area')!,bounds=scroller.getBoundingClientRect(),toolbar=scroller.querySelector('.draft-toolbar')?.getBoundingClientRect().height??0;return {scroller,top:bounds.top+toolbar+12,bottom:bounds.bottom-12};}
  private async revealRange(view:EditorView,from:number,to:number,signal:AbortSignal){
    const start=view.coordsAtPos(from),end=view.coordsAtPos(to);if(!start||!end)throw Error('The walkthrough passage is unavailable.');
    const {scroller,top,bottom}=this.editorBounds(view),before=scroller.scrollTop;
    let target=before;if(start.top<top)target+=start.top-top;else if(end.bottom>bottom)target+=end.bottom-bottom;
    target=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,target));
    if(Math.abs(target-before)>2)await this.animate(this.reduced?0:900,t=>{scroller.scrollTop=before+(target-before)*ease(t);},signal);
  }
  private editor(){
    const element=document.querySelector<HTMLElement>('.cm-editor'),view=element&&EditorView.findFromDOM(element);
    if(!view)throw Error('The walkthrough editor is unavailable.');
    if(!this.decorated.has(view)){this.decorated.add(view);view.dispatch({effects:StateEffect.appendConfig.of(drawSelection({cursorBlinkRate:0}))});}
    return view;
  }
  private async typeText(text:string,write:(value:string)=>Caret|null,signal:AbortSignal,charactersPerTick=2){
    const caret=document.createElement('span');caret.className='tour-typing-caret';caret.setAttribute('aria-hidden','true');
    this.typingCaret=caret;document.body.append(caret);document.body.classList.add('tour-is-typing');this.pointer('hide');
    const update=(value:string)=>{const position=write(value);if(!position)throw Error('The walkthrough typing position is unavailable.');caret.style.transform=`translate3d(${position.left}px,${position.top}px,0)`;caret.style.height=`${Math.max(14,position.bottom-position.top)}px`;};
    try{
      update('');
      for(let i=0;i<text.length;i+=charactersPerTick){update(text.slice(0,i+charactersPerTick));await this.wait(40,signal);}
      await this.wait(650,signal);
    }finally{caret.remove();if(this.typingCaret===caret){this.typingCaret=undefined;document.body.classList.remove('tour-is-typing');}}
  }
  private async typeDraft(signal:AbortSignal){
    const view=this.editor(),r=view.contentDOM.getBoundingClientRect();
    await this.move({x:r.left+12,y:r.top+16},signal);this.pointer('press');await this.wait(170,signal);this.pointer('release');await this.wait(350,signal);
    await this.typeText(sample,value=>{if(value.length>view.state.doc.length)view.dispatch({changes:{from:view.state.doc.length,insert:value.slice(view.state.doc.length)}});const caret=view.coordsAtPos(view.state.doc.length);if(caret){const {scroller,top,bottom}=this.editorBounds(view);if(caret.bottom>bottom)scroller.scrollTop+=caret.bottom-bottom;else if(caret.top<top)scroller.scrollTop-=top-caret.top;}return view.coordsAtPos(view.state.doc.length);},signal,6);
    await this.wait(350,signal);
  }
  private async select(text:string,signal:AbortSignal){
    const view=this.editor(),from=view.state.doc.toString().indexOf(text),to=from+text.length;
    if(from<0)throw Error('The walkthrough passage is unavailable.');
    await this.revealRange(view,from,to,signal);
    const start=view.coordsAtPos(from),end=view.coordsAtPos(to);if(!start||!end)throw Error('The walkthrough passage is outside the editor.');
    this.mark();await this.move({x:start.left,y:(start.top+start.bottom)/2},signal);this.pointer('press');
    await this.move({x:end.left,y:(end.top+end.bottom)/2},signal,1050,false,p=>view.dispatch({selection:{anchor:from,head:from+Math.round((to-from)*p)}}));
    this.pointer('release');await this.wait(550,signal);
  }
  private async field(label:string,text:string,signal:AbortSignal){
    const field=document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);if(!field)throw Error(`The walkthrough field is unavailable: ${label}`);
    await this.pointAt(field,signal);this.pointer('press');await this.wait(170,signal);this.pointer('release');await this.wait(350,signal);
    const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
    // Measure the native textarea's text so the same caret follows its wrapping.
    const mirror=document.createElement('div'),marker=document.createElement('span'),style=getComputedStyle(field);
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word',padding:style.padding,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,fontStyle:style.fontStyle,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,textIndent:style.textIndent});
    mirror.setAttribute('aria-hidden','true');marker.textContent='\u200b';document.body.append(mirror);
    try{await this.typeText(text,value=>{
      set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));
      const bounds=field.getBoundingClientRect();mirror.style.left=`${bounds.left+field.clientLeft-field.scrollLeft}px`;mirror.style.top=`${bounds.top+field.clientTop-field.scrollTop}px`;mirror.style.width=`${field.clientWidth}px`;
      mirror.replaceChildren(document.createTextNode(value),marker);return marker.getBoundingClientRect();
    },signal);}finally{mirror.remove();}
  }
  private async loop(signal:AbortSignal){
    while(!signal.aborted){
      this.position={x:80,y:40};this.pointer('hide');this.mark();await this.fade(0,signal);this.reset();await this.wait(150,signal);await this.until(()=>!!document.querySelector('.cm-editor'),signal);if(this.mobile){this.findButton('Close side panel')?.click();await this.wait(80,signal);}await this.fade(1,signal);
      await this.step('Write','Write your first draft.',signal);await this.typeDraft(signal);
      await this.step('Refine','Try a different wording.',signal);await this.select('a little room to breathe',signal);await this.click('Alternative',signal);
      await this.field('New alternative wording','space to find its shape',signal);await this.click('Add alternative',signal);
      await this.step('Refine','Choose the words you like.',signal);await this.click('Use alternative 1',signal);await this.wait(2200,signal);await this.mobilePanel(false,signal);
      await this.step('Refine','Set a thought aside.',signal);await this.select('This thought can wait while the rest of the piece finds its shape.',signal);await this.click('Set aside',signal);await this.wait(1800,signal);
      await this.step('Refine','Bring it back anytime.',signal);await this.mobilePanel(true,signal);await this.click('Revive',signal);await this.wait(1600,signal);await this.mobilePanel(false,signal);
      await this.step('Write','Keep spare ideas nearby.',signal);await this.select('A note for another day.',signal);await this.click('Overflow',signal);if(this.mobile){const notes=document.querySelector<HTMLElement>('.overflow-editor');if(notes)await this.pointAt(notes,signal);}await this.wait(2200,signal);
      await this.step('Customize','Make Draft your own.',signal);await this.click('Features',signal,true);await this.wait(900,signal);
      await this.field('Feature request','Show reading time beside the word count.',signal);await this.click('Add to your list',signal);await this.wait(1100,signal);
      await this.step('Customize','Keep a list of features.',signal);await this.field('Feature request','Add a focus mode that hides the controls.',signal);await this.click('Add to your list',signal);await this.wait(2000,signal);
      await this.step('Update','Download your changes together.',signal);await this.click('Download update',signal);await this.until(()=>!!this.findButton('Restart to update'),signal);await this.wait(1300,signal);
      await this.step('Update','Restart with your new features.',signal);await this.click('Restart to update',signal,true);await this.wait(1400,signal);
      await this.step('Customize','See what you’ve added.',signal);await this.click(['Features','Update ready'],signal,true);
      const lastChange=document.querySelector<HTMLElement>('.feature-column:nth-child(2) .feature-row:last-child');if(!lastChange)throw Error('The walkthrough update did not add its features.');
      await this.pointAt(lastChange,signal);await this.wait(3200,signal);await this.click('Writing',signal,true);await this.mobilePanel(false,signal);
      await this.step('Write','Your new features, ready to use.',signal);
      const reading=document.querySelector<HTMLElement>('.demo-reading-time');if(!reading)throw Error('Reading time was not activated.');await this.pointAt(reading,signal);await this.wait(2300,signal);
      await this.step('Focus','Write without distractions.',signal);await this.click('Focus',signal);await this.wait(3200,signal);
      await this.step('Write','Back to your full workspace.',signal);await this.click('Exit focus',signal);await this.wait(2600,signal);
      if(!this.store.hasReadingTime||!this.store.hasFocus)throw Error('The walkthrough update did not activate both features.');
    }
  }
}
