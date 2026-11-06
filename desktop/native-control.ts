// Host-owned controls stay available even when a personal native interface fails.
import {join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {Updates} from './updates';
import {exists,within} from './files';
import {writingSchema} from './writing';
import {openExternalLink} from './links';
import type {AgentSelection,UpdateKind} from './types';

export class NativeControl {
  private loading?:Promise<Updates>;
  private recoveryTimer?:ReturnType<typeof setInterval>;
  restart=false;
  constructor(readonly root:string,readonly runtime:string,readonly template:string,readonly packaged=false){}
  ready(){return this.loading??=this.initialize();}
  private async initialize(){
    const updates=new Updates(this.root,this.template,join(this.runtime,'node_modules'),process.execPath,{
      appPath:process.env.DRAFT_APP_PATH,bundleId:process.env.DRAFT_BUNDLE_ID??'com.studiofour.draft.native',hostVersion:process.env.DRAFT_HOST_VERSION,nativeRenderer:true,
    });
    await updates.initialize();
    this.recoveryTimer=setInterval(()=>void updates.recoverIfNeeded().then(recovered=>{if(recovered)this.restart=true;}),2000);this.recoveryTimer.unref();
    if(this.packaged)updates.startAutomaticChecks();
    return updates;
  }
  async close(){if(this.recoveryTimer)clearInterval(this.recoveryTimer);if(this.loading)(await this.loading).stopAutomaticChecks();}
  async handle(request:Request):Promise<Response|null>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/')&&path!=='/updates'&&!path.startsWith('/host-ui/')&&path!=='/host-updates.js')return null;
    const updates=await this.ready();
    const input=request.method==='POST'?await request.json() as any:{};
    let result:unknown;
    switch(`${request.method} ${path}`){
      case 'GET /api/features':result=updates.view();break;
      case 'GET /api/health':result={version:updates.active.id,restartRequested:this.restart,nativeInstallPlan:updates.state.nativeInstallPlan};break;
      case 'GET /api/providers':result={providers:await updates.providers(url.searchParams.has('refresh')),selection:await updates.defaultSelection()};break;
      case 'POST /api/providers/select':await updates.select(input as AgentSelection);result={saved:true};break;
      case 'POST /api/providers/login':if(!['claude','codex'].includes(input.provider))throw Error('Choose Claude Code or Codex.');result={providers:await updates.login(input.provider)};break;
      case 'POST /api/features/queue':result=await updates.queue(input);break;
      case 'POST /api/updates/request':result=await updates.request(input.kind as UpdateKind,String(input.request??''),input.featureId);break;
      case 'POST /api/updates/reconnect':result=await updates.reconnect(input.id);break;
      case 'POST /api/updates/discard':await updates.discard(input.id);result={discarded:true};break;
      case 'POST /api/close/ready':case 'POST /api/close/reset':result={ready:true};break;
      case 'POST /api/updates/apply':result=await updates.apply(input.id,true);this.restart=true;break;
      case 'POST /api/updates/confirm':await updates.confirm(input.version);result={confirmed:true};break;
      case 'POST /api/updates/check':result=await updates.checkOfficial(input.background!==true);break;
      case 'POST /api/updates/resolve':result=await updates.resolveOfficial(input.id,input.choices);break;
      case 'POST /api/updates/abort':this.restart=false;await updates.abortActivation();result={restored:true};break;
      case 'POST /api/updates/handoff':result=await updates.handoff(input);break;
      case 'POST /api/updates/handoff/check':result=await updates.checkHandoff(input.id);break;
      case 'POST /api/assist':{
        if(typeof input.prompt!=='string'||input.prompt.length>100000)throw Error('The writing request is too large.');
        const selection=await updates.defaultSelection();if(!selection)throw Error('Connect Claude Code or Codex in Model settings.');
        const response=await updates.agents.run(selection,input.prompt,{signal:request.signal,schema:writingSchema(input.kind)});
        await updates.rememberConnection(selection.provider);result={response,provider:selection.provider};break;
      }
      case 'POST /api/external':{
        const links:Record<string,string>={claude:'https://claude.com/product/claude-code',codex:'https://developers.openai.com/codex/cli',source:'https://github.com/eabnelson/draft'};
        if(!links[input.kind])throw Error('Unknown link.');await openExternalLink(links[input.kind]);result={opened:true};break;
      }
      default:{
        if(request.method!=='GET'||path.startsWith('/api/'))return Response.json({error:'Not found.'},{status:404});
        const base=join(this.runtime,'host-ui');
        const name=path==='/updates'?'host-ui/index.html':path==='/host-updates.js'?'bridge.js':`.${decodeURIComponent(path.slice('/host-ui'.length))}`;
        const file=resolve(base,name);
        if(!within(base,file)||!await exists(file))return new Response('Not found',{status:404});
        const html=file.endsWith('.html');
        return new Response(html?(await readFile(file,'utf8')).replace('</head>','<script src="/host-updates.js" defer></script></head>'):Bun.file(file),{headers:{...(html?{'Content-Type':'text/html; charset=utf-8'}:{}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});
      }
    }
    return Response.json(result);
  }
}
