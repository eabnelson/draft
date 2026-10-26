import {test,expect} from 'bun:test';
import {walkthroughLayout,fitWalkthrough} from '../website/layout';

test('the walkthrough selects desktop, portrait, and compact landscape layouts',()=>{
  expect(walkthroughLayout(1280,800).id).toBe('desktop');
  expect(walkthroughLayout(390,844).id).toBe('mobile-portrait');
  expect(walkthroughLayout(600,900).id).toBe('mobile-portrait');
  expect(walkthroughLayout(640,390).id).toBe('mobile-landscape');
  expect(walkthroughLayout(900,400).id).toBe('mobile-landscape');
  expect(walkthroughLayout(844,600,true).id).toBe('mobile-landscape');
  expect(walkthroughLayout(844,600,false).id).toBe('desktop');
});

test('shrinking either dimension keeps the full app inside the available space',()=>{
  for(const [width,height] of [[1320,700],[850,390],[362,510],[292,160],[600,250],[0,0],[100,0]]){
    const layout=walkthroughLayout(width,height),fit=fitWalkthrough(width,height,layout);
    expect(fit.width).toBeLessThanOrEqual(width+.00001);expect(fit.height).toBeLessThanOrEqual(height+.00001);
    expect(Number.isFinite(fit.scale)).toBe(true);
    if(fit.scale>0)expect(fit.width/fit.height).toBeCloseTo(layout.width/layout.height,8);
  }
});

test('resizing within each presentation keeps its logical canvas unchanged',()=>{
  expect(walkthroughLayout(1000,800)).toEqual(walkthroughLayout(1400,1000));
  expect(walkthroughLayout(320,640)).toEqual(walkthroughLayout(430,900));
  expect(walkthroughLayout(640,360)).toEqual(walkthroughLayout(900,400));
});
