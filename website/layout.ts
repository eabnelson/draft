export type WalkthroughLayout={id:'desktop'|'mobile-portrait'|'mobile-landscape';width:number;height:number};
export function walkthroughLayout(width:number,height:number,coarsePointer=false):WalkthroughLayout{
  const mobile=width<=700||(width<=1000&&(height<=500||coarsePointer));
  if(!mobile)return {id:'desktop',width:1152,height:720};
  return width>height?{id:'mobile-landscape',width:800,height:480}:{id:'mobile-portrait',width:430,height:780};
}
export function fitWalkthrough(width:number,height:number,layout:WalkthroughLayout){
  const scale=Math.max(0,Math.min(Math.max(0,width)/layout.width,Math.max(0,height)/layout.height));
  return {scale,width:layout.width*scale,height:layout.height*scale};
}
