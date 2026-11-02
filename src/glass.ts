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
