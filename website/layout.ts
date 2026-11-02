// The walkthrough is always the desktop app window, scaled down to fit narrow screens.
export type WalkthroughLayout={id:'desktop';width:number;height:number};
export function walkthroughLayout(_width?:number,_height?:number,_coarsePointer=false):WalkthroughLayout{return {id:'desktop',width:1152,height:720};}
export function fitWalkthrough(width:number,height:number,layout:WalkthroughLayout){
  const scale=Math.max(0,Math.min(Math.max(0,width)/layout.width,Math.max(0,height)/layout.height));
  return {scale,width:layout.width*scale,height:layout.height*scale};
}
