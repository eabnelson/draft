// The whole window is one sheet of frosted glass: the Mac blurs whatever is behind the window,
// and a single fill (.glass-fill) tints it. The full-height lines between the sidebar and the
// first column and between columns are not painted on top; they are thinner places in that sheet,
// so they read as more see-through than the rest.
// The thin places are drawn as an SVG mask over the fill and redrawn whenever the layout moves.

const DIVIDER=0.42, DIVIDER_WIDTH=1;

const grey=(level:number)=>{const v=Math.round(level*255);return `rgb(${v},${v},${v})`;};
const n=(v:number)=>Math.round(v*10)/10;

function maskFor(width:number,height:number):string{
  const shapes:string[]=[];
  // The dividers run the full height of the window at each column's left edge (none before the
  // first column while the sidebar is closed).
  const withSidebar=!!document.querySelector('.with-panel');
  // Only the columns on screen: the writing columns are hidden while Settings is open.
  const columns=[...document.querySelectorAll('.version-column')].map(column=>column.getBoundingClientRect()).filter(r=>r.width>0);
  columns.forEach((r,i)=>{
    if(i===0&&!withSidebar)return;
    shapes.push(`<rect x="${n(r.left)}" y="0" width="${DIVIDER_WIDTH}" height="${height}" fill="${grey(DIVIDER)}"/>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`+
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${shapes.join('')}</mask></defs>`+
    `<rect width="${width}" height="${height}" fill="#000" mask="url(#m)"/></svg>`;
}

// Each tab is drawn as one outline, shaped like Studio Four's sidebar rows: pills with rounded
// corners, and between two pills a short bridge scooped round from above and below. A pill's
// corner runs straight into the scoop, so the outline curves in one smooth line down to the neck
// (Studio Four: 32px rows, 8px corners, a 6px bridge and a 10px neck; Draft's 28px tabs are the
// same shape at 7/8 the size). Drawn as one path, the glass has no seams where pieces meet.
const RADIUS=8;
function pillShape(pill:Element):{fill:string;edge:string}|null{
  const box=pill.getBoundingClientRect();if(!box.width||!box.height)return null;
  const bubbles=[...pill.querySelectorAll(':scope > .version-tab-bubble')].map(b=>b.getBoundingClientRect()).filter(r=>r.width>0).map(r=>({left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top}));
  if(!bubbles.length)return null;
  const top=Math.min(...bubbles.map(b=>b.top)),bottom=Math.max(...bubbles.map(b=>b.bottom)),left=bubbles[0].left,right=bubbles.at(-1)!.right;
  const r=Math.min(RADIUS,(bottom-top)/2,(right-left)/2);
  // Each bridge as the two pill edges it joins; its scoops are half its width across.
  const bridges=bubbles.slice(1).map((b,i)=>[bubbles[i].right,b.left] as const).filter(([a,b])=>b>a);
  const arc=(radius:number,sweep:0|1,x:number,y:number)=>`A${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(x)} ${n(y)}`;
  let d=`M${n(left+r)} ${n(top)}`;
  for(const [a,b] of bridges){const q=(b-a)/2;d+=`L${n(a-r)} ${n(top)}${arc(r,1,a,top+r)}${arc(q,0,b,top+r)}${arc(r,1,b+r,top)}`;}
  d+=`L${n(right-r)} ${n(top)}${arc(r,1,right,top+r)}L${n(right)} ${n(bottom-r)}${arc(r,1,right-r,bottom)}`;
  for(const [a,b] of [...bridges].reverse()){const q=(b-a)/2;d+=`L${n(b+r)} ${n(bottom)}${arc(r,1,b,bottom-r)}${arc(q,0,a,bottom-r)}${arc(r,1,a-r,bottom)}`;}
  d+=`L${n(left+r)} ${n(bottom)}${arc(r,1,left,bottom-r)}L${n(left)} ${n(top+r)}${arc(r,1,left+r,top)}Z`;
  const svg=(edge:boolean)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${n(box.width)}" height="${n(box.height)}" viewBox="0 0 ${n(box.width)} ${n(box.height)}"><path fill="${edge?'none':'#000'}" ${edge?'stroke="#000" stroke-width="1.25"':''} d="${d}"/></svg>`;
  const url=(edge:boolean)=>`url("data:image/svg+xml,${encodeURIComponent(svg(edge))}")`;
  return {fill:url(false),edge:url(true)};
}

export function startGlass(fill:HTMLElement):()=>void{
  let frame=0,last='';
  const draw=()=>{frame=0;
    for(const pill of document.querySelectorAll<HTMLElement>('.version-tab-pill')){
      resize.observe(pill);const shape=pillShape(pill);
      if(shape&&pill.style.getPropertyValue('--pill-shape')!==shape.fill){pill.style.setProperty('--pill-shape',shape.fill);pill.style.setProperty('--pill-edge',shape.edge);}
    }
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
