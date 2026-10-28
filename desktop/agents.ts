import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {readFile,mkdir,realpath,mkdtemp,rm} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import type {Provider,AgentSelection,Model} from './types';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {exists,within} from './files';

export class AgentSignInError extends Error {
  constructor(readonly provider:AgentSelection['provider']){
    super(`Sign in to ${provider==='claude'?'Claude Code':'Codex'} again in Model settings, then try again.`);
    this.name='AgentSignInError';
  }
}
function authenticationFailure(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return /failed to authenticate|authentication_error|oauth token (?:revoked|expired|invalid)|not (?:logged|signed) in|invalid (?:api key|authentication credentials)/i.test(message);
}
export async function readClaudeResult(events:AsyncIterable<SDKMessage>,onProgress?:(message:string)=>void){
  let text='';try{for await(const event of events){
    if(event.type==='assistant')onProgress?.('Implementing your update');
    if(event.type==='result'){
      if(event.is_error){
        const reason='result'in event?event.result:'errors'in event?event.errors.join('\n'):'';
        if(authenticationFailure(reason))throw new AgentSignInError('claude');
        throw Error('The agent could not complete this request. Try again or choose another model.');
      }
      text='structured_output'in event&&event.structured_output?JSON.stringify(event.structured_output):'result'in event?event.result:'';
    }
  }}catch(error){if(authenticationFailure(error))throw new AgentSignInError('claude');throw error;}
  if(!text)throw Error('The agent returned no result.');return text;
}

export function cleanEnvironment():NodeJS.ProcessEnv {
  const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('DRAFT_'))delete env[name];
  env.PATH=[join(homedir(),'.local/bin'),join(homedir(),'.bun/bin'),'/opt/homebrew/bin','/usr/local/bin',env.PATH??'/usr/bin:/bin'].join(':');
  return env;
}
export async function findBinary(name:'claude'|'codex'){
  for(const folder of (cleanEnvironment().PATH??'').split(':')){const path=join(folder,name);if(await exists(path))return path;}
  return undefined;
}
function boundedRun(command:string,args:string[],timeout=12000):Promise<string>{return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{env:cleanEnvironment(),stdio:['ignore','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('The local agent did not respond.'));},timeout);
  child.stdout.on('data',b=>{out+=b;if(out.length>1_000_000){child.kill();reject(Error('The agent response was too large.'));}});child.stderr.on('data',b=>{err=(err+b).slice(-2000);});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(err||'Sign in to this agent to continue.'));});
});}
export function builderSandbox(workspace:string,protectedRoot:string){
  const quote=(v:string)=>JSON.stringify(v);
  // The coding process can use its own auth/config, but never real documents or
  // the controller's activation records. Source candidates live in Caches.
  const privateRoots=[join(protectedRoot,'Documents'),join(protectedRoot,'state.json'),join(homedir(),'Desktop'),join(homedir(),'Downloads'),join(homedir(),'Pictures'),join(homedir(),'Library/Messages'),join(homedir(),'Library/Mail'),join(homedir(),'Library/Application Support/DraftSigning'),join(homedir(),'.appstoreconnect/private_keys')];
  const runtime=resolve(import.meta.dir,'..');
  return `(version 1) (allow default) (deny file-write*) (allow file-write* (subpath ${quote(workspace)}) (subpath ${quote(realpathSync(tmpdir()))}) (subpath "/private/tmp") (subpath ${quote(join(homedir(),'.claude'))}) (subpath ${quote(join(homedir(),'.codex'))}) (subpath ${quote(join(homedir(),'.cache'))}) (literal "/dev/null")) (deny file-read* (require-all (subpath ${quote(join(homedir(),'Documents'))}) (require-not (subpath ${quote(runtime)})))) ${privateRoots.map(p=>`(deny file-read* file-write* (subpath ${quote(p)}))`).join(' ')}`;
}
export class CodexClient {
  private process:ChildProcessWithoutNullStreams;
  private seq=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  listeners=new Set<(method:string,params:any)=>void>();
  constructor(binary:string,workspace?:string,protectedRoot?:string){
    const args=['app-server','--stdio','-c','analytics.enabled=false','-c','features.multi_agent=false','-c','mcp_servers={}'];
    this.process=spawn(workspace?'/usr/bin/sandbox-exec':binary,workspace?['-p',builderSandbox(workspace,protectedRoot!),binary,...args]:args,{env:cleanEnvironment(),cwd:workspace,stdio:['pipe','pipe','pipe']});
    let buffer='';this.process.stdout.on('data',data=>{buffer+=data.toString();if(buffer.length>8_000_000){this.close();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{this.receive(JSON.parse(line));}catch{}}});
    this.process.stderr.on('data',()=>{});
    const failed=()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('The local Codex connection closed.'));}this.pending.clear();};
    this.process.on('error',failed);this.process.on('close',failed);
  }
  private receive(message:any){
    if(message.id!==undefined&&this.pending.has(message.id)){const p=this.pending.get(message.id)!;this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message??'Codex rejected the request.')):p.resolve(message.result);}
    else if(message.method&&message.id!==undefined){this.process.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'This action is not available in Draft.'}})+'\n');}
    else if(message.method)for(const f of this.listeners)f(message.method,message.params);
  }
  request(method:string,params:unknown={},timeout=20000):Promise<any>{const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex took too long to respond.'));},timeout);this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  async initialize(){await this.request('initialize',{clientInfo:{name:'draft',title:'Draft',version:'0.2.0'},capabilities:{experimentalApi:true}});this.process.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');}
  close(){this.process.kill('SIGTERM');}
}
async function claudeModels(binary:string):Promise<Model[]>{
  const {query}=await import('@anthropic-ai/claude-agent-sdk');const abort=new AbortController();
  async function* idle(){await new Promise<void>(resolve=>abort.signal.addEventListener('abort',()=>resolve(),{once:true}));}
  const q=query({prompt:idle(),options:{pathToClaudeCodeExecutable:binary,cwd:tmpdir(),settingSources:[],tools:[],mcpServers:{},abortController:abort,env:cleanEnvironment()}});
  const timeout=setTimeout(()=>abort.abort(),20000);
  try{const models=await q.supportedModels();return models.map(m=>({id:m.resolvedModel??m.value,name:m.displayName,provider:'claude' as const,isDefault:(m.resolvedModel??m.value)==='claude-opus-5-5'}));}
  finally{clearTimeout(timeout);abort.abort();q.close();}
}
export class Agents {
  private cache?:{at:number;providers:Provider[]};
  private authenticationFailures=new Map<AgentSelection['provider'],string>();
  async discover(refresh=false):Promise<Provider[]>{
    if(this.cache&&!refresh&&Date.now()-this.cache.at<60000)return this.cache.providers;
    const providers=await Promise.all((['claude','codex'] as const).map(async id=>{
      const binary=await findBinary(id);const p:Provider={id,name:id==='claude'?'Claude Code':'Codex',installed:!!binary,ready:false,path:binary,models:[]};if(!binary)return p;
      if(this.authenticationFailures.has(id)){p.error=this.authenticationFailures.get(id);return p;}
      try{
        if(id==='claude'){
          const status=JSON.parse(await boundedRun(binary,['auth','status','--json']));if(!status.loggedIn)throw Error('Sign in to Claude Code.');
          p.models=await claudeModels(binary);if(!p.models.length)throw Error('Claude Code returned no available models.');
        }else{
          const client=new CodexClient(binary);try{await client.initialize();const account=await client.request('account/read',{refreshToken:false});if(!account.account)throw Error('Sign in to Codex.');const response=await client.request('model/list',{limit:100,includeHidden:false});p.models=(response.data??[]).map((m:any)=>({id:m.model??m.id,name:m.displayName??m.model??m.id,provider:'codex',isDefault:!!m.isDefault}));if(!p.models.length)throw Error('Codex returned no available models.');}finally{client.close();}
        }p.ready=true;
      }catch(e){p.error=e instanceof Error?e.message:'This provider is not ready.';}return p;
    }));this.cache={at:Date.now(),providers};return providers;
  }
  async select(saved?:AgentSelection):Promise<AgentSelection|undefined>{
    const ready=(await this.discover()).filter(p=>p.ready);
    if(saved&&ready.some(p=>p.id===saved.provider&&p.models.some(m=>m.id===saved.model)))return saved;
    const claude=ready.find(p=>p.id==='claude'),opus=claude?.models.find(m=>m.id==='claude-opus-5-5');
    if(opus)return {provider:'claude',model:opus.id};
    const provider=claude??ready[0];const model=provider?.models.find(m=>m.isDefault)??provider?.models[0];return provider&&model?{provider:provider.id,model:model.id}:undefined;
  }
  async run(selection:AgentSelection,prompt:string,options:{workspace?:string;protectedRoot?:string;signal?:AbortSignal;schema?:Record<string,unknown>;onProgress?:(message:string)=>void}={}):Promise<string>{
    const binary=await findBinary(selection.provider);if(!binary)throw Error(`Install ${selection.provider==='claude'?'Claude Code':'Codex'} to continue.`);
    if(selection.provider==='claude'){
      const {query}=await import('@anthropic-ai/claude-agent-sdk');const abort=new AbortController();const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});
      const q=query({prompt,options:{model:selection.model,pathToClaudeCodeExecutable:binary,cwd:options.workspace??tmpdir(),settingSources:[],tools:options.workspace?['Read','Edit','Write','Glob','Grep']:[],mcpServers:{},permissionMode:'default',abortController:abort,env:cleanEnvironment(),maxTurns:options.workspace?80:4,
        ...(options.schema?{outputFormat:{type:'json_schema',schema:options.schema}}:{}),
        ...(options.workspace?{spawnClaudeCodeProcess:spawnOptions=>spawn('/usr/bin/sandbox-exec',['-p',builderSandbox(options.workspace!,options.protectedRoot!),spawnOptions.command,...spawnOptions.args],{cwd:spawnOptions.cwd,env:spawnOptions.env,stdio:['pipe','pipe','pipe'],signal:spawnOptions.signal}),
          canUseTool:async(name,input)=>{
            if(!['Read','Edit','Write','Glob','Grep'].includes(name))return {behavior:'deny',message:'Use the candidate source files; the host runs build and test checks.'};
            const target=String(input.file_path??input.path??options.workspace);let canonical=resolve(options.workspace!,target);try{canonical=await realpath(canonical);}catch{try{canonical=join(await realpath(dirname(canonical)),canonical.split('/').at(-1)!);}catch{}}
            return within(options.workspace!,canonical)?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'Only the candidate source workspace is available for this change.'};
          }}:{})}});
      try{const result=await readClaudeResult(q,options.onProgress);if(this.authenticationFailures.delete('claude'))this.cache=undefined;return result;}
      catch(error){if(error instanceof AgentSignInError){this.authenticationFailures.set('claude',error.message);this.cache=undefined;}throw error;}
      finally{abort.abort();q.close();options.signal?.removeEventListener('abort',cancel);}
    }
    const writingWorkspace=options.workspace?undefined:await mkdtemp(join(tmpdir(),'draft-writing-'));
    const client=new CodexClient(binary,options.workspace??writingWorkspace,options.protectedRoot??join(homedir(),'Library/Application Support/Draft'));
    try{
      await client.initialize();const thread=await client.request('thread/start',{model:selection.model,cwd:options.workspace??writingWorkspace,approvalPolicy:'never',sandbox:options.workspace?'workspace-write':'read-only',ephemeral:true,...(!options.workspace?{baseInstructions:'Answer the writing request using only the supplied text. Return the requested answer directly. File, shell, browser, and external tools are outside this task.'}:{})});
      const threadId=thread.thread.id;let text='';
      const result=new Promise<string>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('The coding agent exceeded its time limit.')),options.workspace?20*60000:3*60000);
        const cancel=()=>{void client.request('turn/interrupt',{threadId}).catch(()=>{});clearTimeout(timer);reject(Error('Request cancelled.'));};options.signal?.addEventListener('abort',cancel,{once:true});
        client.listeners.add((method,p)=>{if(p?.threadId&&p.threadId!==threadId)return;
          if(method==='item/agentMessage/delta')text+=p.delta??'';
          if(method==='item/completed'&&p.item?.type==='agentMessage')text=p.item.text??text;
          if(method==='item/started')options.onProgress?.('Implementing your update');
          if(method==='turn/completed'){clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);p.turn.status==='completed'?resolve(text):reject(Error(p.turn.error?.message??'The coding agent stopped before finishing.'));}
        });
      });
      await client.request('turn/start',{threadId,input:[{type:'text',text:prompt}],model:selection.model,...(options.schema?{outputSchema:options.schema}:{})});return await result;
    }finally{client.close();if(writingWorkspace)await rm(writingWorkspace,{recursive:true,force:true});}
  }
  async login(provider:'claude'|'codex'){
    const path=await findBinary(provider);if(!path)throw Error(`Install ${provider==='claude'?'Claude Code':'Codex'} first.`);
    await boundedRun(path,provider==='claude'?['auth','login']:['login'],180000);this.authenticationFailures.delete(provider);this.cache=undefined;return this.discover(true);
  }
}
