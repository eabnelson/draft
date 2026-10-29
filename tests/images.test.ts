import {test,expect} from 'bun:test';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {IMAGE_SHAPES,shapeById,cropFor,centered,clampFraming,panFraming,outputSize,imageMarkdown,imageInsertion,safeImageSource,MAX_ZOOM,parseImages,imageAt,findImage} from '../src/images';
import {plainText} from '../src/markdown';
import {words} from '../src/model';
import {ImageStore} from '../desktop/images';

const photo={width:4000,height:3000};
const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,5,6,7,8]);

test('the shape picker names each platform with its exact export size',()=>{
 const sizes=Object.fromEntries(IMAGE_SHAPES.map(s=>[s.label,`${s.ratio} ${s.width}x${s.height}`]));
 expect(sizes).toEqual({'Instagram Reel':'9:16 1080x1920','Instagram carousel':'4:5 1080x1350','Instagram tall slide':'3:4 1080x1440','TikTok':'9:16 1080x1920','YouTube & web':'16:9 1920x1080'});
 for(const s of IMAGE_SHAPES){const [w,h]=s.ratio.split(':').map(Number);expect(s.width/s.height).toBeCloseTo(w/h,5);}
});
test('a new crop is the largest centered frame of the chosen shape',()=>{
 const reel=cropFor(photo,9/16,centered(photo));
 expect(reel.height).toBe(3000);expect(reel.width).toBeCloseTo(1687.5);expect(reel.x).toBeCloseTo((4000-1687.5)/2);expect(reel.y).toBe(0);
 const wide=cropFor({width:1000,height:2000},16/9,centered({width:1000,height:2000}));
 expect(wide.width).toBe(1000);expect(wide.height).toBeCloseTo(562.5);expect(wide.y).toBeCloseTo((2000-562.5)/2);
});
test('zoom and panning keep the frame inside the picture',()=>{
 const aspect=4/5,zoomed=cropFor(photo,aspect,{zoom:2,centerX:2000,centerY:1500});
 expect(zoomed.height).toBe(1500);expect(cropFor(photo,aspect,{zoom:99,centerX:0,centerY:0}).width).toBeCloseTo(3000*aspect/MAX_ZOOM);
 const corner=cropFor(photo,aspect,{zoom:2,centerX:-500,centerY:99999});expect(corner.x).toBe(0);expect(corner.y+corner.height).toBe(3000);
 const clamped=clampFraming(photo,aspect,{zoom:1,centerX:0,centerY:0}),crop=cropFor(photo,aspect,clamped);
 expect(clamped.centerX).toBeCloseTo(crop.width/2);
});
test('dragging the picture right reveals more of its left side',()=>{
 const aspect=9/16,start={zoom:1,centerX:2000,centerY:1500},before=cropFor(photo,aspect,start);
 const after=cropFor(photo,aspect,panFraming(photo,aspect,start,100,0,500));
 expect(after.x).toBeCloseTo(before.x-100*(before.width/500));
 expect(cropFor(photo,aspect,panFraming(photo,aspect,start,100000,0,500)).x).toBe(0);
});
test('social shapes export at platform size and Original keeps the crop, capped for huge photos',()=>{
 expect(outputSize({width:200,height:300},shapeById('instagram-carousel'))).toEqual({width:1080,height:1350});
 expect(outputSize({width:1234,height:567},undefined)).toEqual({width:1234,height:567});
 expect(outputSize({width:12000,height:6000},undefined)).toEqual({width:4096,height:2048});
});
test('a pasted image becomes its own paragraph wherever the cursor is',()=>{
 const md='![Instagram Reel 9:16](/api/images/0123456789abcdef0123456789abcdef.png)';
 const middle=imageInsertion('One two. Three four.',{from:8,to:8},md);
 expect('One two. Three four.'.slice(0,middle.from)+middle.insert+'One two. Three four.'.slice(middle.to)).toBe(`One two.\n\n${md}\n\n Three four.`);
 expect(imageInsertion('',{from:0,to:0},md).insert).toBe(`${md}\n\n`);
 expect(imageInsertion('First.\n\nSecond.',{from:8,to:8},md).insert).toBe(`${md}\n\n`);
 const replaced=imageInsertion('Keep this. Replace me',{from:11,to:21},md);expect(replaced.insert).toBe(`\n\n${md}\n\n`);expect(replaced.cursor).toBe(11+replaced.insert.length);
});
test('image Markdown only references stored or inline images and adds no words',()=>{
 const src='/api/images/0123456789abcdef0123456789abcdef.png';
 expect(imageMarkdown(src,'a [tricky]\nalt')).toBe(`![a  tricky  alt](${src})`);
 for(const bad of ['javascript:alert(1)','https://example.com/a.png','/api/images/../../secret.png','/api/images/abc.png','data:text/html;base64,AAAA'])expect(()=>imageMarkdown(bad)).toThrow();
 expect(safeImageSource('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
 const text=`Before the photo.\n\n![Instagram Reel 9:16](${src})\n\nAfter it.`;
 expect(plainText(text)).toBe('Before the photo.\n\nAfter it.');expect(words(plainText(text))).toBe(5);
});
test('a cropped image keeps its original and framing so it can be cropped again',()=>{
 const original='/api/images/0123456789abcdef0123456789abcdef.jpg',cropped='/api/images/fedcba9876543210fedcba9876543210.jpg';
 const md=imageMarkdown(cropped,'',{original,shape:'instagram-carousel',framing:{zoom:1.23456,centerX:812.345,centerY:500}});
 expect(md).toBe(`![](${cropped} "draft-crop:instagram-carousel 1.2346 812.35 500 ${original}")`);
 const text=`Intro.\n\n${md}\n\nMore.\n\n![](${original})`,[first,second]=parseImages(text);
 expect(first).toMatchObject({src:cropped,markdown:md,crop:{original,shape:'instagram-carousel',framing:{zoom:1.2346,centerX:812.35,centerY:500}}});
 expect(second.crop).toBeUndefined();expect(second.src).toBe(original);
 expect(imageAt(text,first.from+3)?.src).toBe(cropped);expect(imageAt(text,2)).toBeUndefined();
 expect(findImage(`Typed more first. ${text}`,md)?.from).toBe(first.from+18);
 expect(plainText(text)).toBe('Intro.\n\nMore.');
 for(const bad of [`![](${cropped} "draft-crop:unknown 1 2 3 ${original}")`,`![](${cropped} "draft-crop:tiktok 1 2 3 javascript:alert(1)")`])expect(parseImages(bad)[0].crop).toBeUndefined();
 expect(parseImages('![x](https://example.com/a.png)')).toHaveLength(0);
 expect(()=>imageMarkdown(cropped,'',{original:'https://example.com/a.png',shape:'tiktok',framing:{zoom:1,centerX:0,centerY:0}})).toThrow();
});
test('the image store checks bytes, shares identical images and serves only its own files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'draft-images-'));try{
  const store=new ImageStore(root);
  const first=await store.save(png,'image/png'),second=await store.save(png,'image/png');
  expect(first.src).toMatch(/^\/api\/images\/[a-f0-9]{32}\.png$/);expect(second).toEqual(first);expect(await readdir(root)).toHaveLength(1);
  expect(safeImageSource(first.src)).toBe(true);
  await expect(store.save(jpeg,'image/png')).rejects.toThrow('not a valid image');
  await expect(store.save(png,'text/html')).rejects.toThrow();
  await expect(store.save(new Uint8Array(),'image/png')).rejects.toThrow();
  const served=await store.response(first.src);expect(served.status).toBe(200);expect(served.headers.get('content-type')).toBe('image/png');expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  for(const bad of ['/api/images/../library.json','/api/images/x.png','/api/images/0123456789abcdef0123456789abcdef.svg'])expect((await store.response(bad)).status).toBe(404);
  const runs:string[][]=[];await store.copy(first.src,async args=>{runs.push(args);});
  expect(runs[0].at(-1)).toBe(join(root,first.src.slice('/api/images/'.length)));expect(runs[0].join(' ')).toContain('«class PNGf»');
  const photo=await store.save(jpeg,'image/jpeg');await store.copy(photo.src,async args=>{runs.push(args);});expect(runs[1].join(' ')).toContain('«class JPEG»');
  await expect(store.copy('/api/images/ffffffffffffffffffffffffffffffff.png',async()=>{})).rejects.toThrow('no longer available');
 }finally{await rm(root,{recursive:true,force:true});}
});
