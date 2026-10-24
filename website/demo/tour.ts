import {EditorView} from '@codemirror/view';
import type {DemoStore} from './store';
const sample='Good writing needs room.\n\nA first draft is a place to begin. Try a different word. Give an idea a little room to breathe.\n\nThis thought can wait while the rest of the piece finds its shape.\n\nA note for another day.';
const announce=(scene:string,state='playing')=>window.dispatchEvent(new CustomEvent('draft-demo-scene',{detail:{scene,state}}));
export class Tour{
  private controller?:AbortController;
  constructor(private store:DemoStore,private reset:()=>void){}
  pause(){this.controller?.abort();this.controller=undefined;announce('Make it yours','paused');}
  play(){if(this.controller)return;const controller=new AbortController();this.controller=controller;void this.loop(controller.signal).catch(error=>{if(!controller.signal.aborted){console.error(error);this.pause();}});}
  replay(){this.pause();this.play();}
  private async wait(ms:number,signal:AbortSignal){await new Promise<void>((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
  private reveal(element:Element){const r=element.getBoundingClientRect();if(r.top<20||r.bottom>window.innerHeight-20)window.scrollTo({top:Math.max(0,window.scrollY+r.top-80),behavior:'smooth'});}
  private button(text:string){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text||b.getAttribute('aria-label')===text);if(!button)throw Error(`Missing demo control: ${text}`);this.reveal(button);button.click();}
  private field(label:string,text:string){const field=document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);if(!field)throw Error(`Missing demo field: ${label}`);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,text);field.dispatchEvent(new Event('input',{bubbles:true}));}
  private editor(){const element=document.querySelector<HTMLElement>('.cm-editor');if(!element)throw Error('Missing editor');return EditorView.findFromDOM(element)!;}
  private select(text:string){const view=this.editor(),from=view.state.doc.toString().indexOf(text);if(from<0)throw Error('Missing demo passage');view.dispatch({selection:{anchor:from,head:from+text.length},scrollIntoView:true});view.focus();}
  private async loop(signal:AbortSignal){
    while(!signal.aborted){
      this.reset();window.scrollTo(0,0);announce('Write');await this.wait(900,signal);
      for(const part of sample.split(/(?<=\s)/)){const view=this.editor();view.dispatch({changes:{from:view.state.doc.length,insert:part}});await this.wait(42,signal);}
      await this.wait(1200,signal);this.select('a little room to breathe');await this.wait(180,signal);this.button('Alternative');await this.wait(800,signal);
      this.field('New alternative wording','space to find its shape');await this.wait(450,signal);this.button('Add alternative');await this.wait(700,signal);this.button('Use alternative 1');await this.wait(1800,signal);
      this.select('This thought can wait while the rest of the piece finds its shape.');await this.wait(180,signal);this.button('Set aside');await this.wait(1600,signal);this.button('Revive');await this.wait(800,signal);
      this.select('A note for another day.');await this.wait(180,signal);this.button('Overflow');await this.wait(1600,signal);
      announce('Make it yours');this.button('Features');await this.wait(900,signal);
      this.field('Feature request','Show reading time beside the word count.');await this.wait(650,signal);this.button('Add to your list');await this.wait(900,signal);
      this.field('Feature request','Add a focus mode that hides the controls.');await this.wait(650,signal);this.button('Add to your list');await this.wait(1500,signal);
      announce('Update');this.button('Download update');await this.wait(7600,signal);this.button('Restart to update');await this.wait(1800,signal);
      const features=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Features'||b.textContent?.trim()==='Update ready');features?.click();await this.wait(1000,signal);
      const changes=document.querySelector('.features-columns');if(changes)this.reveal(changes);await this.wait(2500,signal);this.button('Writing');await this.wait(900,signal);window.scrollTo(0,0);
      this.button('Focus');await this.wait(2500,signal);this.button('Exit focus');await this.wait(2300,signal);
      if(!this.store.hasReadingTime||!this.store.hasFocus)throw Error('The demo update did not activate both features.');
    }
  }
}
