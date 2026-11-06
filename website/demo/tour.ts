// The landing page walkthrough: the writing workflow Draft is built for, in the real app driven the way a
// person would, with a glass cursor drawn by the page around it. A brain dump, new versions
// beside it, refining more than one, marking one ready, then asking Draft for a feature and
// restarting into it. It loops until the visitor pauses it.
import {EditorView} from '@codemirror/view';
import {TOUR} from './store';

export const OPENING='Write messy. Shape it later.';
const ease=(t:number)=>t*t*(3-2*t);
type Point={x:number;y:number};

export class Tour{
  private controller?:AbortController;
  private paused=false;
  private scene='Intro';
  private headline=OPENING;
  private position:Point={x:640,y:420};
  private caret?:HTMLElement;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(private reset:()=>void,private finishUpdate:()=>void){}

  private announce(){window.dispatchEvent(new CustomEvent('draft-demo-scene',{detail:{scene:this.scene,headline:this.headline,state:this.paused?'paused':'playing'}}));}
  private pointer(kind:string,point?:Point){window.dispatchEvent(new CustomEvent('draft-demo-pointer',{detail:{kind,...point}}));}
  pause(){if(!this.controller)return;this.paused=true;this.caret?.style.setProperty('animation-play-state','paused');this.announce();}
  play(){
    if(this.controller){this.paused=false;this.caret?.style.setProperty('animation-play-state','running');this.announce();return;}
    this.paused=false;const controller=new AbortController();this.controller=controller;
    void this.loop(controller.signal).catch(error=>{
      if(controller.signal.aborted)return;
      console.error(error);this.controller=undefined;this.paused=true;this.headline=OPENING;this.pointer('hide');this.announce();this.root.style.opacity='1';
    });
  }
  replay(autoplay=true){
    this.controller?.abort();this.controller=undefined;this.cleanup();this.pointer('reset');
    if(autoplay){this.play();return;}
    this.paused=true;this.reset();this.root.style.opacity='1';this.scene='Intro';this.headline=OPENING;this.announce();
  }

  private get root(){return document.getElementById('root')!;}
  private animate(duration:number,update:(progress:number)=>void,signal:AbortSignal){
    return new Promise<void>((resolve,reject)=>{
      if(signal.aborted){reject(signal.reason);return;}
      let elapsed=0,last=performance.now(),frame=0;
      const abort=()=>{cancelAnimationFrame(frame);reject(signal.reason);};
      const tick=(now:number)=>{
        const delta=Math.min(48,now-last);last=now;
        if(!this.paused){elapsed+=delta;const progress=duration?Math.min(1,elapsed/duration):1;update(progress);if(progress===1){signal.removeEventListener('abort',abort);resolve();return;}}
        frame=requestAnimationFrame(tick);
      };
      signal.addEventListener('abort',abort,{once:true});frame=requestAnimationFrame(tick);
    });
  }
  private wait(ms:number,signal:AbortSignal){return this.animate(ms,()=>{},signal);}
  private async until<T>(find:()=>T|null|undefined|false,signal:AbortSignal,limit=8000):Promise<T>{
    for(let elapsed=0;elapsed<limit;elapsed+=100){const found=find();if(found)return found;await this.wait(100,signal);}
    throw Error('The walkthrough could not reach its next step.');
  }
  private async step(scene:string,headline:string,signal:AbortSignal){this.scene=scene;this.headline=headline;this.announce();await this.wait(700,signal);}
  private async move(point:Point,signal:AbortSignal,duration=800,onProgress?:(progress:number)=>void){
    const from={...this.position},dx=point.x-from.x,dy=point.y-from.y,arc=Math.min(18,Math.hypot(dx,dy)*.025);
    await this.animate(this.reduced?0:duration,t=>{const p=ease(t);this.position={x:from.x+dx*p,y:from.y+dy*p-Math.sin(Math.PI*p)*arc};this.pointer('move',this.position);onProgress?.(p);},signal);
  }
  private center(element:Element):Point{const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}
  private async press(element:Element,signal:AbortSignal,act:()=>void){
    await this.move(this.center(element),signal);await this.wait(180,signal);
    this.pointer('press');await this.wait(140,signal);act();this.pointer('release');await this.wait(450,signal);
  }
  private click(element:Element,signal:AbortSignal){return this.press(element,signal,()=>(element as HTMLElement).click());}
  private button(label:string){return [...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(b=>b.textContent?.trim()===label&&b.getClientRects().length);}
  // Types into a text field the app controls, one character at a time.
  private async fill(field:HTMLTextAreaElement|HTMLInputElement,text:string,signal:AbortSignal){
    const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field),'value')!.set!;
    for(let i=1;i<=text.length;i++){set.call(field,text.slice(0,i));field.dispatchEvent(new Event('input',{bubbles:true}));await this.wait(this.reduced?0:24+Math.random()*24,signal);}
  }
  private menuItem(label:string){return [...document.querySelectorAll<HTMLButtonElement>('.context-menu button:not(:disabled)')].find(b=>b.textContent?.trim()===label);}

  // A keyboard shortcut, shown as a glass chip at the bottom of the window while it runs.
  private async shortcut(keys:string[],label:string,init:KeyboardEventInit,signal:AbortSignal){
    const chip=document.createElement('div');chip.className='tour-keys';chip.setAttribute('aria-hidden','true');
    for(const key of keys){const k=document.createElement('kbd');k.textContent=key;chip.append(k);}
    const text=document.createElement('span');text.textContent=label;chip.append(text);document.body.append(chip);
    try{
      await this.wait(30,signal);chip.classList.add('is-shown');await this.wait(650,signal);
      window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init}));
      await this.wait(900,signal);chip.classList.remove('is-shown');await this.wait(250,signal);
    }finally{chip.remove();}
  }

  private editor(index:number){
    const element=document.querySelectorAll('.version-column .cm-editor')[index];
    const view=element&&EditorView.findFromDOM(element as HTMLElement);if(!view)throw Error('The walkthrough editor is unavailable.');return view;
  }
  // Types into an editor one character at a time, with a blinking caret drawn over the text.
  private async type(view:EditorView,text:string,signal:AbortSignal,replace=false){
    const caret=document.createElement('span');caret.className='tour-caret';caret.setAttribute('aria-hidden','true');
    this.caret=caret;document.body.append(caret);document.body.classList.add('tour-is-typing');this.pointer('hide');
    const place=()=>{const at=view.coordsAtPos(view.state.selection.main.head);if(at){caret.style.transform=`translate3d(${at.left}px,${at.top}px,0)`;caret.style.height=`${Math.max(14,at.bottom-at.top)}px`;}};
    try{
      if(!replace)view.dispatch({selection:{anchor:view.state.doc.length}});
      place();await this.wait(350,signal);
      for(let i=0;i<text.length;i++){
        const {from,to}=view.state.selection.main;
        view.dispatch({changes:{from,to,insert:text[i]},selection:{anchor:from+1},userEvent:'input.type',scrollIntoView:true});place();
        const pause=/[.,]/.test(text[i])&&text[i+1]===' '?140:18+Math.random()*22;
        await this.wait(this.reduced?0:pause,signal);
      }
      await this.wait(400,signal);
    }finally{this.cleanupCaret(caret);}
  }
  private cleanupCaret(caret?:HTMLElement){caret?.remove();if(!caret||this.caret===caret){this.caret=undefined;document.body.classList.remove('tour-is-typing');}}
  private cleanup(){this.cleanupCaret(this.caret);document.querySelectorAll('.tour-keys').forEach(e=>e.remove());}

  private async fade(opacity:number,signal:AbortSignal){const start=Number(getComputedStyle(this.root).opacity);await this.animate(this.reduced?0:320,p=>{this.root.style.opacity=String(start+(opacity-start)*ease(p));},signal);}

  // Opens a copy of the version you are in beside it, then selects all of it and types a rewrite.
  private async newVersion(index:number,text:string,signal:AbortSignal){
    await this.shortcut(['⌘','T'],'New version',{key:'t',metaKey:true},signal);
    await this.until(()=>document.querySelectorAll('.version-column').length===index+1,signal);
    await this.wait(500,signal);
    const view=this.editor(index),end=view.state.doc.length,start=view.coordsAtPos(0),stop=view.coordsAtPos(end);
    if(!start||!stop)throw Error('The walkthrough text is outside the window.');
    await this.move({x:start.left,y:(start.top+start.bottom)/2},signal,800);
    this.pointer('press');
    await this.move({x:stop.left,y:(stop.top+stop.bottom)/2},signal,1000,p=>view.dispatch({selection:{anchor:0,head:Math.round(end*p)}}));
    this.pointer('release');await this.wait(400,signal);
    await this.type(view,text,signal,true);
  }
  // Names a version from its tab's right-click menu.
  private async rename(index:number,name:string,signal:AbortSignal){
    const tab=document.querySelectorAll('.version-column:not(.settings-column) .version-tab-pill')[index];
    await this.press(tab,signal,()=>{const at=this.center(tab);tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:at.x,clientY:at.y}));});
    await this.click(await this.until(()=>this.menuItem('Rename'),signal),signal);
    const field=await this.until(()=>document.querySelector<HTMLInputElement>('.version-rename'),signal);
    field.value='';
    for(const ch of name){field.value+=ch;await this.wait(this.reduced?0:70,signal);}
    await this.wait(300,signal);
    field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await this.wait(700,signal);
  }
  // Switches to a version by pressing its tab, then adds to the end of it.
  private async refine(index:number,text:string,signal:AbortSignal){
    const tab=document.querySelectorAll('.version-column:not(.settings-column) .version-tab-pill')[index];
    await this.press(tab,signal,()=>tab.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0})));
    await this.until(()=>tab.getAttribute('aria-selected')==='true',signal);
    await this.type(this.editor(index),text,signal);
  }

  private async loop(signal:AbortSignal){
    for(;;){
      this.reset();this.position={x:640,y:420};await this.fade(1,signal);
      this.scene='Intro';this.headline=OPENING;this.announce();
      await this.wait(1800,signal);

      // A brain dump in a new draft. Its first sentence names it until the AI suggests a title.
      await this.step('Dump','Start with a brain dump.',signal);
      await this.shortcut(['⌘','N'],'New draft',{key:'n',metaKey:true},signal);
      await this.until(()=>document.querySelector('.inbox-row.is-active .inbox-title')?.textContent==='Untitled draft',signal);
      await this.type(this.editor(0),TOUR.dump,signal);
      const row=await this.until(()=>document.querySelector('.inbox-row.is-active .inbox-title')?.textContent===TOUR.title&&document.querySelector('.inbox-row.is-active'),signal);
      await this.move(this.center(row.querySelector('.inbox-title')!),signal,900);await this.wait(1200,signal);

      // New versions beside it: a clean rewrite, then a short one made from that.
      await this.step('Versions','Spin off new versions.',signal);
      await this.newVersion(1,TOUR.clean,signal);
      await this.rename(1,TOUR.cleanName,signal);
      await this.newVersion(2,TOUR.short,signal);
      await this.rename(2,TOUR.shortName,signal);

      // Going back and forth, refining more than one.
      await this.step('Refine','Refine a few side by side.',signal);
      await this.refine(1,TOUR.cleanMore,signal);
      await this.refine(2,TOUR.shortMore,signal);

      // When one feels right, it is marked ready in the sidebar.
      await this.step('Ready','Mark the one that’s ready.',signal);
      const chip=await this.until(()=>document.querySelector('.inbox-row.is-active [data-stage-chip]'),signal);
      await this.click(chip,signal);
      await this.click(await this.until(()=>this.menuItem('Ready'),signal),signal);
      await this.wait(1400,signal);

      await this.step('Appearance','Make yourself at home.',signal);
      await this.click(await this.until(()=>document.querySelector('button[aria-label="Settings"]'),signal),signal);
      await this.click(await this.until(()=>document.querySelector('.settings-sidebar [data-section="appearance"]'),signal),signal);
      await this.click(await this.until(()=>document.querySelector('[role="radio"][aria-label="Dark"]'),signal),signal);
      await this.wait(1600,signal);
      await this.click(await this.until(()=>document.querySelector('[role="radio"][aria-label="Light"]'),signal),signal);
      await this.wait(1000,signal);

      await this.step('Shortcuts','Keep your hands on the keys.',signal);
      await this.click(await this.until(()=>document.querySelector('.settings-sidebar [data-section="shortcuts"]'),signal),signal);
      await this.until(()=>document.querySelector('.shortcut-card kbd'),signal);
      await this.wait(2200,signal);
      await this.click(await this.until(()=>document.querySelector('button[aria-label="Back to drafts"]'),signal),signal);

      // Customizing: asking Draft for a feature in Settings, building it, and restarting into it.
      await this.step('Customize','Add whatever you need.',signal);
      await this.click(await this.until(()=>document.querySelector('button[aria-label="Settings"]'),signal),signal);
      await this.click(await this.until(()=>document.querySelector('.settings-sidebar [data-section="customize"]'),signal),signal);
      const field=await this.until(()=>document.querySelector<HTMLTextAreaElement>('.feature-request textarea'),signal);
      await this.press(field,signal,()=>{});
      await this.fill(field,TOUR.request,signal);await this.wait(300,signal);
      await this.click(await this.until(()=>this.button('Add feature'),signal),signal);
      await this.click(await this.until(()=>this.button('Download update'),signal),signal);
      await this.wait(2600,signal);this.finishUpdate();
      await this.click(await this.until(()=>this.button('Restart to update'),signal),signal);
      await this.until(()=>document.querySelector('.demo-goal'),signal);
      await this.step('Customized','Ask for anything. Draft builds it.',signal);
      // Back on the brain dump, the new bubble counts its words toward the goal.
      const first=document.querySelector('.version-column:not(.settings-column) .version-tab-pill')!;
      await this.press(first,signal,()=>first.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0})));
      const goal=await this.until(()=>first.querySelector('.demo-goal'),signal),at=this.center(goal);
      await this.move({x:at.x,y:at.y+30},signal,700);await this.wait(2400,signal);

      this.scene='Try';this.headline='Try it on your Mac.';this.announce();this.pointer('hide');
      await this.wait(4500,signal);
      await this.fade(0,signal);
    }
  }
}
