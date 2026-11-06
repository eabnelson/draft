import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import {existsSync} from 'node:fs';

export class NativeSpelling {
  private child?:ChildProcessWithoutNullStreams;
  private sequence=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private executable:string){}
  get available(){return process.platform==='darwin'?existsSync(this.executable):!!Bun.which('hunspell');}
  private start(){
    if(this.child)return this.child;
    const child=spawn(this.executable,[],{stdio:'pipe'});this.child=child;let buffer='';
    const failed=()=>{if(this.child!==child)return;this.child=undefined;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(Error('Spelling is temporarily unavailable.'));}this.pending.clear();};
    child.on('error',failed);child.on('exit',failed);child.stdin.on('error',failed);
    child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
      buffer+=chunk;if(buffer.length>1_000_000){child.kill();return;}
      let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const response=JSON.parse(line),task=this.pending.get(response.id);if(task){clearTimeout(task.timer);this.pending.delete(response.id);response.error?task.reject(Error(response.error)):task.resolve(response);}}catch{child.kill();}}
    });
    child.stderr.resume();return child;
  }
  request(input:{text:string}|{word:string}):Promise<any>{
    if(process.platform==='linux')return linuxSpelling(input);
    if(!this.available)return Promise.resolve({available:false,words:[],suggestions:[]});
    if('text' in input?(typeof input.text!=='string'||input.text.length>200000):(typeof input.word!=='string'||input.word.length>100))return Promise.reject(Error('Choose a shorter passage to check.'));
    return new Promise((resolve,reject)=>{const child=this.start(),id=++this.sequence;const timer=setTimeout(()=>{child.kill();},5000);this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,...input})+'\n');});
  }
  close(){this.child?.kill();}
}
export const spellingExecutable=(runtime:string)=>join(runtime,'draft-spelling');

async function linuxSpelling(input:{text:string}|{word:string}){
  if(!Bun.which('hunspell'))return {available:false,words:[],suggestions:[]};
  const text='text' in input?input.text:input.word;
  if(typeof text!=='string'||text.length>('text'in input?200000:100))throw Error('Choose a shorter passage to check.');
  const tokens=[...text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].slice(0,1000);
  if(!tokens.length)return {available:true,words:[],suggestions:[]};
  const child=Bun.spawn(['hunspell','-a','-i','UTF-8'],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  child.stdin.write(tokens.map(t=>'^'+t[0]).join('\n')+'\n');child.stdin.end();
  const timer=setTimeout(()=>child.kill(),5000);
  try{
    const output=await new Response(child.stdout).text();const error=await new Response(child.stderr).text();
    if(await child.exited)throw Error(error.trim()||'Install a Hunspell dictionary for your language.');
    const groups=output.replace(/^[^\n]*\n/,'').trim().split(/\n\s*\n/);
    const words: {from:number;to:number;word:string}[]=[];let suggestions:string[]=[];
    for(let i=0;i<tokens.length;i++){
      const line=groups[i]??'';if(!/^[&#]/.test(line))continue;
      const token=tokens[i];words.push({from:token.index!,to:token.index!+token[0].length,word:token[0]});
      if('word' in input)suggestions=(line.split(': ')[1]??'').split(', ').filter(Boolean).slice(0,5);
    }
    return {available:true,words,suggestions};
  }finally{clearTimeout(timer);}
}
