import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import {existsSync} from 'node:fs';

export class NativeSpelling {
  private child?:ChildProcessWithoutNullStreams;
  private sequence=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private executable:string){}
  get available(){return process.platform==='darwin'&&existsSync(this.executable);}
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
    if(!this.available)return Promise.resolve({available:false,words:[],suggestions:[]});
    if('text' in input?(typeof input.text!=='string'||input.text.length>200000):(typeof input.word!=='string'||input.word.length>100))return Promise.reject(Error('Choose a shorter passage to check.'));
    return new Promise((resolve,reject)=>{const child=this.start(),id=++this.sequence;const timer=setTimeout(()=>{child.kill();},5000);this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,...input})+'\n');});
  }
  close(){this.child?.kill();}
}
export const spellingExecutable=(runtime:string)=>join(runtime,'draft-spelling');
