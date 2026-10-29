import type {Span} from './model';
import {markdownParser} from './markdown';

// Social sizes as of October 2026. The label names the platform; the ratio is supporting detail.
export type ImageShape={id:string;label:string;ratio:string;width:number;height:number;note?:string};
export const IMAGE_SHAPES:ImageShape[]=[
  {id:'instagram-reel',label:'Instagram Reel',ratio:'9:16',width:1080,height:1920},
  {id:'instagram-carousel',label:'Instagram carousel',ratio:'4:5',width:1080,height:1350},
  {id:'instagram-tall',label:'Instagram tall slide',ratio:'3:4',width:1080,height:1440,note:'Taller slides posted in the app'},
  {id:'tiktok',label:'TikTok',ratio:'9:16',width:1080,height:1920,note:'Videos and photo carousels'},
  {id:'horizontal',label:'YouTube & web',ratio:'16:9',width:1920,height:1080,note:'Horizontal video'},
];
export const ORIGINAL_SHAPE='original';
export const shapeById=(id:string)=>IMAGE_SHAPES.find(s=>s.id===id);

export type Size={width:number;height:number};
export type Crop={x:number;y:number;width:number;height:number};
// zoom 1 is the largest crop of the requested shape; center is in image pixels.
export type Framing={zoom:number;centerX:number;centerY:number};
export const MAX_ZOOM=4;

export function cropFor(image:Size,aspect:number,framing:Framing):Crop {
  const zoom=Math.min(MAX_ZOOM,Math.max(1,framing.zoom));
  const fullWidth=Math.min(image.width,image.height*aspect);
  const width=fullWidth/zoom,height=width/aspect;
  const x=Math.min(image.width-width,Math.max(0,framing.centerX-width/2));
  const y=Math.min(image.height-height,Math.max(0,framing.centerY-height/2));
  return {x,y,width,height};
}
export const centered=(image:Size):Framing=>({zoom:1,centerX:image.width/2,centerY:image.height/2});
// Keep the framing inside the image so the next drag starts from what is visible.
export function clampFraming(image:Size,aspect:number,framing:Framing):Framing {
  const crop=cropFor(image,aspect,framing);
  return {zoom:Math.min(MAX_ZOOM,Math.max(1,framing.zoom)),centerX:crop.x+crop.width/2,centerY:crop.y+crop.height/2};
}
// Dragging the picture moves it under a fixed frame, so the crop moves the other way.
export function panFraming(image:Size,aspect:number,framing:Framing,dx:number,dy:number,frameWidth:number):Framing {
  const crop=cropFor(image,aspect,framing),scale=crop.width/frameWidth;
  return clampFraming(image,aspect,{...framing,centerX:crop.x+crop.width/2-dx*scale,centerY:crop.y+crop.height/2-dy*scale});
}
// Social shapes export at the platform's size. Original keeps the cropped pixels, capped
// so a huge photo stays practical to store and copy.
export function outputSize(crop:Size,shape:ImageShape|undefined,limit=4096):Size {
  if(shape)return {width:shape.width,height:shape.height};
  const scale=Math.min(1,limit/Math.max(crop.width,crop.height));
  return {width:Math.max(1,Math.round(crop.width*scale)),height:Math.max(1,Math.round(crop.height*scale))};
}

export const IMAGE_SOURCE=/^\/api\/images\/[a-f0-9]{32}\.(?:png|jpg|webp|gif)$/;
export const safeImageSource=(src:string)=>IMAGE_SOURCE.test(src)||/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(src);
// A cropped image remembers its untouched original in the Markdown title, so it can be re-cropped.
export type ImageCrop={original:string;shape:string;framing:Framing};
export type DraftImage={from:number;to:number;markdown:string;alt:string;src:string;crop?:ImageCrop};
const CROP_TITLE=/^draft-crop:([a-z-]+) (\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (\S+)$/;
export function imageMarkdown(src:string,alt='',crop?:ImageCrop):string {
  if(!safeImageSource(src)||(crop&&!safeImageSource(crop.original)))throw Error('This image cannot be added to your draft.');
  if(crop&&crop.shape!==ORIGINAL_SHAPE&&!shapeById(crop.shape))throw Error('Choose an image shape.');
  const title=crop?` "draft-crop:${crop.shape} ${+crop.framing.zoom.toFixed(4)} ${+crop.framing.centerX.toFixed(2)} ${+crop.framing.centerY.toFixed(2)} ${crop.original}"`:'';
  return `![${alt.replace(/[\[\]\\\n]/g,' ').trim()}](${src}${title})`;
}
export function parseImages(text:string):DraftImage[] {
  const images:DraftImage[]=[];
  markdownParser.parse(text).iterate({enter(node){
    if(node.name!=='Image')return;
    const url=node.node.getChild('URL'),title=node.node.getChild('LinkTitle'),close=node.node.getChildren('LinkMark').find(m=>text.slice(m.from,m.to)===']');
    const src=url?text.slice(url.from,url.to):'';
    if(!close||!safeImageSource(src))return false;
    const match=title?CROP_TITLE.exec(text.slice(title.from+1,title.to-1)):null;
    const crop=match&&safeImageSource(match[5])&&(match[1]===ORIGINAL_SHAPE||shapeById(match[1]))?{original:match[5],shape:match[1],framing:{zoom:Number(match[2]),centerX:Number(match[3]),centerY:Number(match[4])}}:undefined;
    images.push({from:node.from,to:node.to,markdown:text.slice(node.from,node.to),alt:text.slice(node.from+2,close.from),src,...(crop?{crop}:{})});
    return false;
  }});
  return images;
}
export const imageAt=(text:string,pos:number)=>parseImages(text).find(image=>image.from<=pos&&pos<=image.to);
// The panel follows its image by content, which survives typing elsewhere in the draft.
export const findImage=(text:string,markdown:string)=>parseImages(text).find(image=>image.markdown===markdown);
// Images sit on their own paragraph so they never split a word or a marked passage.
export function imageInsertion(text:string,at:Span,markdown:string):Span&{insert:string;cursor:number} {
  const before=text.slice(0,at.from),after=text.slice(at.to);
  const lead=!before?'':before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n';
  const trail=!after?'\n\n':after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
  const insert=lead+markdown+trail;
  return {from:at.from,to:at.to,insert,cursor:at.from+insert.length};
}

export function pastedImage(data:DataTransfer|null):File|null {
  if(!data)return null;
  for(const file of Array.from(data.files))if(/^image\/(png|jpeg|webp|gif)$/.test(file.type))return file;
  for(const item of Array.from(data.items))if(item.kind==='file'&&/^image\/(png|jpeg|webp|gif)$/.test(item.type)){const file=item.getAsFile();if(file)return file;}
  return null;
}
export function renderCrop(image:CanvasImageSource,crop:Crop,size:Size,type:'image/png'|'image/jpeg'):Promise<Blob> {
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d');if(!context)throw Error('This image could not be prepared.');
  context.imageSmoothingQuality='high';
  if(type==='image/jpeg'){context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);}
  context.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,size.width,size.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('This image could not be prepared.')),type,.92));
}
async function pngBlob(blob:Blob):Promise<Blob> {
  if(blob.type==='image/png')return blob;
  const bitmap=await createImageBitmap(blob);
  try{return await renderCrop(bitmap,{x:0,y:0,width:bitmap.width,height:bitmap.height},{width:bitmap.width,height:bitmap.height},'image/png');}finally{bitmap.close();}
}
// The ClipboardItem must be created during the click; its contents may finish loading afterwards.
export async function copyImageToClipboard(source:string|Blob|Promise<Blob>):Promise<void> {
  const png=(async()=>pngBlob(typeof source==='string'?await (await fetch(source,{credentials:'same-origin'})).blob():await source))();
  await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
}
