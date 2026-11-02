// The landing page walkthrough: it drives the real app the way a person would, with a glass
// cursor drawn by the page around it, in three scenes: write a draft, version it, and mark it
// ready to post. It loops until the visitor pauses it.
import {EditorView} from '@codemirror/view';
import {TOUR} from './store';

export const OPENING='Write it, version it, post it.';
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
  constructor(private reset:()=>void){}

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

  private async loop(signal:AbortSignal){
    for(;;){
      this.reset();this.position={x:640,y:420};await this.fade(1,signal);
      this.scene='Intro';this.headline=OPENING;this.announce();
      await this.wait(1400,signal);

      // Write: a new draft from the keyboard. Its first sentence names it until the AI suggests a title.
      await this.step('Write','Write it.',signal);
      await this.shortcut(['⌘','N'],'New draft',{key:'n',metaKey:true},signal);
      await this.until(()=>document.querySelector('.inbox-row.is-active .inbox-title')?.textContent==='Untitled draft',signal);
      await this.type(this.editor(0),TOUR.first,signal);
      const row=await this.until(()=>document.querySelector('.inbox-row.is-active .inbox-title')?.textContent===TOUR.title&&document.querySelector('.inbox-row.is-active'),signal);
      await this.move(this.center(row.querySelector('.inbox-title')!),signal,900);await this.wait(1400,signal);

      // Version: a copy opens beside it, gets a shorter rewrite and a name of its own.
      await this.step('Version','Version it.',signal);
      await this.shortcut(['⌘','T'],'New version',{key:'t',metaKey:true},signal);
      await this.until(()=>document.querySelectorAll('.version-column').length===2,signal);
      await this.wait(500,signal);
      const view=this.editor(1),end=view.state.doc.length,start=view.coordsAtPos(0),stop=view.coordsAtPos(end);
      if(!start||!stop)throw Error('The walkthrough text is outside the window.');
      await this.move({x:start.left,y:(start.top+start.bottom)/2},signal,800);
      this.pointer('press');
      await this.move({x:stop.left,y:(stop.top+stop.bottom)/2},signal,1000,p=>view.dispatch({selection:{anchor:0,head:Math.round(end*p)}}));
      this.pointer('release');await this.wait(500,signal);
      await this.type(view,TOUR.short,signal,true);
      const tab=document.querySelectorAll('.version-tab-pill')[1];
      await this.press(tab,signal,()=>{const at=this.center(tab);tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:at.x,clientY:at.y}));});
      await this.click(await this.until(()=>this.menuItem('Rename'),signal),signal);
      const field=await this.until(()=>document.querySelector<HTMLInputElement>('.version-rename'),signal);
      field.value='';
      for(const ch of TOUR.versionName){field.value+=ch;await this.wait(this.reduced?0:70,signal);}
      await this.wait(350,signal);
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await this.wait(900,signal);
      await this.shortcut(['⌃','Tab'],'Switch tabs',{key:'Tab',ctrlKey:true},signal);
      await this.wait(500,signal);

      // Post: mark it ready from the sidebar.
      await this.step('Post','Post it.',signal);
      const chip=await this.until(()=>document.querySelector('.inbox-row.is-active [data-stage-chip]'),signal);
      await this.click(chip,signal);
      await this.click(await this.until(()=>this.menuItem('Ready'),signal),signal);
      await this.wait(1600,signal);

      this.scene='Intro';this.headline=OPENING;this.announce();this.pointer('hide');
      await this.wait(4500,signal);
      await this.fade(0,signal);
    }
  }
}
