import {walkthroughLayout,fitWalkthrough} from './layout';

const frame=document.querySelector<HTMLIFrameElement>('#demo')!;
const slot=document.querySelector<HTMLElement>('#stage-slot')!;
const viewer=document.querySelector<HTMLElement>('.demo-frame')!;
const viewport=document.querySelector<HTMLElement>('.demo-viewport')!;
const toggle=document.querySelector<HTMLButtonElement>('#toggle')!;
const headline=document.querySelector<HTMLHeadingElement>('#headline')!;
const openingHeadline={text:headline.textContent,html:headline.innerHTML,title:document.title};
const cursor=document.querySelector<HTMLElement>('.glass-cursor')!;
const disc=cursor.querySelector<HTMLElement>('.cursor-disc')!;
const ripple=cursor.querySelector<HTMLElement>('.cursor-ripple')!;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let layout=walkthroughLayout(window.innerWidth,window.innerHeight,matchMedia('(pointer: coarse)').matches);
let width=layout.width,height=layout.height,layoutId=0,layoutPending=false;
let playing=!reduced,ready=false,scale=1,position={x:80,y:44},titleAnimation:Animation|undefined;
const send=(command:string,details:Record<string,unknown>={})=>frame.contentWindow?.postMessage({channel:'draft-demo',command,...details},location.origin);
function placeCursor(){cursor.style.transform=`translate3d(${position.x*scale}px,${position.y*scale}px,0) translate(-50%,-50%)`;}
function fit(){
  const next=walkthroughLayout(window.innerWidth,window.innerHeight,matchMedia('(pointer: coarse)').matches),changed=next.id!==layout.id;
  layout=next;width=layout.width;height=layout.height;
  frame.width=String(width);frame.height=String(height);frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  viewer.dataset.layout=layout.id;
  const availableWidth=Math.max(0,slot.clientWidth-2),availableHeight=Math.max(0,slot.clientHeight-2);
  const fitted=fitWalkthrough(availableWidth,availableHeight,layout);scale=fitted.scale;
  viewer.style.width=`${fitted.width+2}px`;viewer.style.height=`${fitted.height+2}px`;
  frame.style.transform=`scale(${scale})`;placeCursor();viewer.classList.add('is-ready');
  if(changed&&ready){layoutPending=true;cursor.classList.remove('visible');send('layout',{playing,layoutId:++layoutId});}
}
new ResizeObserver(fit).observe(slot);fit();
window.addEventListener('resize',fit);
function sync(){toggle.textContent=playing?'Pause':'Play';toggle.setAttribute('aria-label',playing?'Pause':'Play');}
function title(text:string){
  if(!text||text===headline.textContent)return;
  titleAnimation?.cancel();
  document.title=text===openingHeadline.text?openingHeadline.title:`${text} — Draft`;
  const update=()=>{if(text===openingHeadline.text)headline.innerHTML=openingHeadline.html;else headline.textContent=text;};
  if(reduced){update();return;}
  const out=headline.animate([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'});titleAnimation=out;
  void out.finished.then(()=>{update();out.cancel();titleAnimation=headline.animate([{opacity:0},{opacity:1}],{duration:260,easing:'ease-out'});}).catch(()=>{});
}
function pointer(value:{kind:string;x?:number;y?:number}){
  if(value.kind==='move'&&Number.isFinite(value.x)&&Number.isFinite(value.y)){
    position={x:Math.max(0,Math.min(width,value.x!)),y:Math.max(0,Math.min(height,value.y!))};placeCursor();cursor.classList.add('visible');
  }
  if(value.kind==='hide'||value.kind==='reset'){cursor.classList.remove('visible');cursor.classList.remove('pressed');}
  if(value.kind==='press'){
    cursor.classList.add('pressed');
    if(!reduced){disc.animate([{transform:'scale(1)'},{transform:'scale(.8)'},{transform:'scale(1)'}],{duration:360,easing:'ease-out'});ripple.animate([{transform:'translate(-50%,-50%) scale(.3)',opacity:.8},{transform:'translate(-50%,-50%) scale(1.6)',opacity:0}],{duration:800,easing:'cubic-bezier(.2,.7,.2,1)'});}
  }
  if(value.kind==='release')cursor.classList.remove('pressed');
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.channel!=='draft-demo')return;
  const value=event.data;
  if(value.pointer){if(!layoutPending)pointer(value.pointer);return;}
  if(value.state==='layout-ready'){if(value.layoutId===layoutId)layoutPending=false;return;}
  if(value.state==='ready'){if(!ready){ready=true;if(playing)send('play');}return;}
  if(typeof value.headline==='string')title(value.headline);
  if(typeof value.scene==='string')viewer.dataset.scene=value.scene;
  if(value.state==='paused')playing=false;
  if(value.state==='playing')playing=true;
  sync();
});
frame.addEventListener('load',()=>send('hello'));
toggle.onclick=()=>{playing=!playing;send(playing?'play':'pause');sync();};
document.querySelector<HTMLButtonElement>('#replay')!.onclick=()=>{playing=true;pointer({kind:'reset'});send('replay');sync();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&ready){playing=false;send('pause');sync();}});
new IntersectionObserver(entries=>{if(!entries[0].isIntersecting&&ready&&playing){playing=false;send('pause');sync();}},{threshold:0}).observe(viewport);
sync();
