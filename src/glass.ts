// The whole window is one sheet of frosted glass: the Mac blurs whatever is behind the window,
// and a single fill (.glass-fill) tints it. Selected things are not painted on top; they are
// thinner places in that sheet, so they read as more see-through than the rest:
//   - the open draft in the sidebar,
//   - the full-height line between the sidebar and the first column and between columns.
// The thin places are drawn as an SVG mask over the fill and redrawn whenever the layout moves.

const SELECTED=0.42, DIVIDER=0.42, DIVIDER_WIDTH=1;

const grey=(level:number)=>{const v=Math.round(level*255);return `rgb(${v},${v},${v})`;};
const n=(v:number)=>Math.round(v*10)/10;

function maskFor(width:number,height:number):string{
  const shapes:string[]=[];
  const box=(el:Element,level:number,radius=8,clip?:DOMRect)=>{
    let r=el.getBoundingClientRect();if(!r.width||!r.height)return;
    if(clip){const top=Math.max(r.top,clip.top),bottom=Math.min(r.bottom,clip.bottom);if(bottom<=top)return;r=new DOMRect(r.left,top,r.width,bottom-top);}
    shapes.push(`<rect x="${n(r.left)}" y="${n(r.top)}" width="${n(r.width)}" height="${n(r.height)}" rx="${radius}" fill="${grey(level)}"/>`);
  };
  // The open draft in the sidebar, cut to the part of the list you can see.
  const list=document.querySelector('.inbox-list');
  const selected=list?.querySelector(':scope>li.is-active');
  if(list&&selected)box(selected,SELECTED,8,list.getBoundingClientRect());
  // The dividers run the full height of the window at each column's left edge (none before the
  // first column while the sidebar is closed).
  const withSidebar=!!document.querySelector('.with-panel');
  document.querySelectorAll('.version-column').forEach((column,i)=>{
    if(i===0&&!withSidebar)return;
    const r=column.getBoundingClientRect();
    shapes.push(`<rect x="${n(r.left)}" y="0" width="${DIVIDER_WIDTH}" height="${height}" fill="${grey(DIVIDER)}"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`+
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${shapes.join('')}</mask></defs>`+
    `<rect width="${width}" height="${height}" fill="#000" mask="url(#m)"/></svg>`;
}

export function startGlass(fill:HTMLElement):()=>void{
  let frame=0,last='';
  const draw=()=>{frame=0;
    const svg=maskFor(innerWidth,innerHeight);if(svg===last)return;last=svg;
    const url=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    fill.style.setProperty('-webkit-mask-image',url);fill.style.setProperty('mask-image',url);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};
  const resize=new ResizeObserver(schedule);resize.observe(document.body);
  // Typing inside the text changes nothing here except the tab counts, which sit outside the editor.
  const mutations=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Node&&(r.target.parentElement??r.target as Element)?.closest?.('.cm-editor'))))schedule();});mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style'],characterData:true});
  addEventListener('resize',schedule);addEventListener('scroll',schedule,true);
  schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();removeEventListener('resize',schedule);removeEventListener('scroll',schedule,true);};
}
