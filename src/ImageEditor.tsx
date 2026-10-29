import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Copy,X,LoaderCircle,Minus,Plus,Undo2,Check} from 'lucide-react';
import {Button} from './components/ui/button';
import {IMAGE_SHAPES,ORIGINAL_SHAPE,MAX_ZOOM,shapeById,cropFor,centered,clampFraming,panFraming,outputSize,renderCrop,type Framing,type Size,type DraftImage,type ImageCrop} from './images';

type MenuProps={x:number;y:number;onCopy:()=>void;onClose:(restoreFocus?:boolean)=>void};
export function ImageMenu({x,y,onCopy,onClose}:MenuProps){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const pointer=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))onClose();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose(true);}};
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key,true);};
  },[]);
  return <div className="text-menu image-menu" ref={ref} role="menu" aria-label="Image options" style={{left:Math.max(8,Math.min(x,innerWidth-188)),top:Math.max(8,Math.min(y,innerHeight-60))}} onKeyDown={e=>{if(e.key==='Tab')onClose();}}>
    <Button variant="ghost" role="menuitem" onClick={()=>{onCopy();onClose(true);}}><Copy size={15}/>Copy image</Button>
  </div>;
}

type Props={image:DraftImage;onApply:(image:Blob,crop:ImageCrop)=>Promise<void>;onReset:()=>void;onCopy:(image:string|Promise<Blob>)=>void;onClose:()=>void};
export function ImagePanel({image,onApply,onReset,onCopy,onClose}:Props){
  const original=image.crop?.original??image.src;
  const [picture,setPicture]=useState<{element:HTMLImageElement;size:Size}|null>(null);
  const [shapeId,setShapeId]=useState(image.crop?.shape??ORIGINAL_SHAPE),[framing,setFraming]=useState<Framing|null>(image.crop?.framing??null);
  const [stage,setStage]=useState<Size>({width:0,height:0}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [menu,setMenu]=useState<{x:number;y:number}|null>(null);
  const stageRef=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number;pointer:number}|null>(null);
  const shape=shapeById(shapeId),size=picture?.size;
  const aspect=shape?shape.width/shape.height:size?size.width/size.height:1;
  // Another image, or the same one after Apply: start from what the draft now shows.
  useEffect(()=>{setShapeId(image.crop?.shape??ORIGINAL_SHAPE);setFraming(image.crop?.framing??null);setError('');setBusy(false);},[image.markdown]);
  useEffect(()=>{
    const element=new Image();let live=true;setPicture(null);
    element.onload=()=>{if(!live)return;const size={width:element.naturalWidth,height:element.naturalHeight};setPicture({element,size});setFraming(current=>current??centered(size));};
    element.onerror=()=>{if(live)setError('This image could not be opened.');};
    element.src=original;return()=>{live=false;};
  },[original]);
  useLayoutEffect(()=>{
    const node=stageRef.current;if(!node)return;
    const measure=()=>setStage({width:node.clientWidth,height:node.clientHeight});
    const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();
  },[]);
  const room={width:Math.max(0,stage.width-28),height:Math.max(0,stage.height-28)};
  const frame=room.width/room.height>aspect?{width:room.height*aspect,height:room.height}:{width:room.width,height:room.width/aspect};
  const crop=size&&framing?cropFor(size,aspect,framing):null,scale=crop?frame.width/crop.width:1;
  const placement=size&&crop?{width:size.width*scale,height:size.height*scale,left:-crop.x*scale,top:-crop.y*scale}:null;
  const uncropped=shapeId===ORIGINAL_SHAPE&&(framing?.zoom??1)<=1.001;
  const unchanged=image.crop?shapeId===image.crop.shape&&!!framing&&Math.abs(framing.zoom-image.crop.framing.zoom)<.001&&Math.abs(framing.centerX-image.crop.framing.centerX)<.5&&Math.abs(framing.centerY-image.crop.framing.centerY)<.5:uncropped;
  function choose(id:string){
    setShapeId(id);
    if(size)setFraming(current=>{const next=shapeById(id),ratio=next?next.width/next.height:size.width/size.height;return clampFraming(size,ratio,{...(current??centered(size)),zoom:1});});
  }
  function zoom(value:number){if(size&&framing)setFraming(clampFraming(size,aspect,{...framing,zoom:value}));}
  function nudge(dx:number,dy:number){if(size&&framing&&frame.width)setFraming(panFraming(size,aspect,framing,dx,dy,frame.width));}
  function result():Promise<Blob>{
    if(!picture||!crop)return Promise.reject(Error('The image is still loading.'));
    return renderCrop(picture.element,crop,outputSize(crop,shape),/^data:image\/jpeg|\.jpg$/.test(original)?'image/jpeg':'image/png');
  }
  async function apply(){
    if(busy||!crop||!framing||unchanged)return;
    if(uncropped){onReset();return;}
    setBusy(true);setError('');
    try{await onApply(await result(),{original,shape:shapeId,framing});}
    catch(e){setError(e instanceof Error?e.message:'This crop could not be applied.');setBusy(false);}
  }
  const shapes=[{id:ORIGINAL_SHAPE,label:'Original',detail:size?`${size.width} × ${size.height}`:'As pasted',aspect:size?size.width/size.height:1},...IMAGE_SHAPES.map(s=>({id:s.id,label:s.label,detail:`${s.ratio} · ${s.width} × ${s.height}`,aspect:s.width/s.height}))];
  const output=crop?outputSize(crop,shape):null;
  return <aside className="side-panel image-panel" aria-label="Image" onKeyDown={e=>{
    if(menu)return;
    if(e.key==='Escape'){e.preventDefault();onClose();return;}
    if(e.key==='Enter'&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();void apply();}
  }}>
    <div className="panel-header"><span>Image</span><Button variant="ghost" size="icon-xs" className="panel-close" aria-label="Close image panel" onClick={onClose}><X size={14}/></Button></div>
    <div className="panel-scroll image-panel-scroll">
      <div className="image-stage" ref={stageRef} tabIndex={0} aria-label="Crop preview. Drag to reposition, scroll to zoom."
        onPointerDown={e=>{if(e.button!==0||!crop)return;drag.current={x:e.clientX,y:e.clientY,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{const start=drag.current;if(!start||start.pointer!==e.pointerId)return;nudge(e.clientX-start.x,e.clientY-start.y);drag.current={...start,x:e.clientX,y:e.clientY};}}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
        onWheel={e=>{if(framing)zoom(framing.zoom*Math.exp(-e.deltaY*(e.ctrlKey?.01:.002)));}}
        onDoubleClick={()=>{if(size)setFraming(centered(size));}}
        onKeyDown={e=>{const step=e.shiftKey?40:8,keys:Record<string,[number,number]>={ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]};
          if(keys[e.key]){e.preventDefault();nudge(...keys[e.key]);}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom((framing?.zoom??1)*1.1);}else if(e.key==='-'){e.preventDefault();zoom((framing?.zoom??1)/1.1);}}}>
        {picture&&placement&&<div className="image-frame-area" style={{width:frame.width,height:frame.height}}>
          <img className="image-context" src={original} alt="" aria-hidden="true" draggable={false} style={placement}/>
          <div className="image-frame" onContextMenu={e=>{e.preventDefault();setMenu({x:e.clientX,y:e.clientY});}} title="Right-click to copy">
            <img src={original} alt="Image as it will appear" draggable={false} style={placement}/>
          </div>
        </div>}
        {!picture&&!error&&<div className="image-loading" role="status"><LoaderCircle className="spin" size={16}/>Opening image…</div>}
      </div>
      <p className="image-hint">Drag to reposition · scroll to zoom</p>
      <div className="image-shapes" role="radiogroup" aria-label="Image shape" onKeyDown={e=>{
        if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();e.stopPropagation();
        const i=shapes.findIndex(s=>s.id===shapeId),next=shapes[(i+(e.key==='ArrowDown'?1:-1)+shapes.length)%shapes.length];choose(next.id);
        requestAnimationFrame(()=>e.currentTarget.querySelector<HTMLButtonElement>(`[data-shape="${next.id}"]`)?.focus());
      }}>
        {shapes.map(s=><button type="button" key={s.id} role="radio" data-shape={s.id} aria-checked={s.id===shapeId} tabIndex={s.id===shapeId?0:-1} className="image-shape" onClick={()=>choose(s.id)}>
          <span className="image-shape-icon" aria-hidden="true"><i style={s.aspect>=1?{width:20,height:20/s.aspect}:{width:20*s.aspect,height:20}}/></span>
          <span className="image-shape-text"><strong>{s.label}</strong><small>{s.detail}</small></span>
          {s.id===shapeId&&<Check size={13} className="image-shape-check"/>}
        </button>)}
      </div>
      <label className="image-zoom"><span>Zoom</span><span className="image-zoom-row"><Minus size={13} aria-hidden="true"/><input type="range" min={1} max={MAX_ZOOM} step={.01} value={framing?.zoom??1} disabled={!crop} aria-label="Zoom" onChange={e=>zoom(Number(e.target.value))}/><Plus size={13} aria-hidden="true"/></span></label>
      {output&&<p className="image-output">{uncropped?'Shown as pasted':`Becomes a ${output.width} × ${output.height} image`}</p>}
      {error&&<p className="image-error" role="alert">{error}</p>}
      <div className="image-actions">
        <Button variant="default" className="primary-button" disabled={busy||!crop||unchanged} onClick={()=>void apply()}>{busy?<><LoaderCircle className="spin" size={14}/>Applying…</>:uncropped&&image.crop?'Use original':'Apply crop'}</Button>
        <div className="image-secondary">
          <Button variant="ghost" disabled={!crop} onClick={()=>onCopy(unchanged?image.src:result())}><Copy size={13}/>Copy image</Button>
          {image.crop&&!uncropped&&<Button variant="ghost" disabled={busy} onClick={onReset}><Undo2 size={13}/>Use original</Button>}
        </div>
      </div>
    </div>
    {menu&&<ImageMenu x={menu.x} y={menu.y} onCopy={()=>onCopy(unchanged?image.src:result())} onClose={()=>setMenu(null)}/>}
  </aside>;
}
