import {spawn} from 'node:child_process';
import {safeLinkURL} from '../src/markdown';

async function systemOpen(url:string){
  await new Promise<void>((resolve,reject)=>{const child=spawn('/usr/bin/open',[url],{stdio:'ignore'});child.once('error',()=>reject(Error('Draft couldn’t open this link.')));child.once('exit',code=>code===0?resolve():reject(Error('Draft couldn’t open this link.')));});
}
export async function openExternalLink(value:unknown,open:(url:string)=>Promise<void>=systemOpen){
  const url=typeof value==='string'?safeLinkURL(value):null;
  if(!url)throw Error('Use a web address or mailto: link.');
  await open(url);
}
