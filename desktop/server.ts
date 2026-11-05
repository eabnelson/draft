import {join,resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {DraftStore,MAX_MEDIA_BYTES} from './documents';
import {copyImageFile} from './images';
import {Updates} from './updates';
import {writingSchema} from './writing';
import {NativeSpelling,spellingExecutable} from './spelling';
import {openExternalLink} from './links';
import {ZoSync} from './zo-sync';
import {within,exists,readJSON,atomicWrite} from './files';
import {plainText} from '../src/markdown';
import type {AgentSelection,UpdateKind} from './types';

const dev=process.argv.includes('--dev');
const root=resolve(process.env.DRAFT_DATA_ROOT??join(homedir(),'Library/Application Support/Draft'));
const runtime=resolve(process.env.DRAFT_RUNTIME_ROOT??join(import.meta.dir,'..'));
const template=resolve(process.env.DRAFT_TEMPLATE_ROOT??(dev?runtime:join(runtime,'source-template')));
const dependencies=join(runtime,'node_modules');
const session=process.env.DRAFT_SESSION_TOKEN;
if(!dev&&!session)throw Error('Start Draft through the desktop app.');
// Draft 1 documents in Documents/ migrate once and stay there as the recovery copy.
const documents=new DraftStore(join(root,'Drafts'),join(root,'Documents'));
const spelling=new NativeSpelling(spellingExecutable(runtime));
const testHost=process.env.DRAFT_BUNDLE_ID?.endsWith('.update-check')===true;
const updates=new Updates(root,template,dependencies,process.execPath,{appPath:process.env.DRAFT_APP_PATH,bundleId:process.env.DRAFT_BUNDLE_ID,hostVersion:process.env.DRAFT_HOST_VERSION,...(testHost?{feed:process.env.DRAFT_UPDATE_FEED,allowLocal:true}:{} )});
await updates.initialize();
// Drafts kept in sync with a folder in the person's Zo workspace, in the background.
const sync=new ZoSync(root,documents);
await sync.initialize();
if(!dev)updates.startAutomaticChecks();
// Mac preferences the native shell reads from /api/health.
type Preferences={menuBarIcon:boolean;openAtLogin:boolean};
const preferencesPath=join(root,'preferences.json');
let preferences:Preferences={menuBarIcon:true,openAtLogin:true};
try{preferences={...preferences,...await readJSON<Partial<Preferences>>(preferencesPath)};}catch{}
let recoveryCounter=0,closeReady=false,restartRequested=false;let activeRuntime:{id:string;handler:((request:Request)=>Promise<Response|null>)|null}|undefined;
const json=(value:unknown,status=200)=>Response.json(value,{status});
function authorized(request:Request){if(dev)return true;const cookie=request.headers.get('cookie')??'';return cookie.split(';').some(s=>s.trim()===`draft_session=${session}`)||request.headers.get('authorization')===`Bearer ${session}`;}
const server=Bun.serve({hostname:'127.0.0.1',port:dev?Number(process.env.DRAFT_DEV_PORT??4319):0,idleTimeout:0,maxRequestBodySize:30*1024*1024,
  async fetch(request){
    const url=new URL(request.url),origin=`http://127.0.0.1:${server.port}`;
    if(!dev&&url.searchParams.has('token')){
      if(url.searchParams.get('token')!==session)return new Response('Unauthorized',{status:401});
      return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':`draft_session=${session}; HttpOnly; SameSite=Strict; Path=/`,'Cache-Control':'no-store'}});
    }
    if(!authorized(request))return new Response('Open Draft through its desktop app.',{status:401});
    const requestOrigin=request.headers.get('origin');
    if(requestOrigin&&requestOrigin!==origin)return new Response('Forbidden',{status:403});
    const media=/^\/api\/drafts\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,150})\/media(?:\/([^/]+))?$/.exec(url.pathname);
    if(media?.[2]&&request.method==='GET')return documents.mediaResponse(media[1],media[2]);
    // Image types are not CORS-safelisted, so cross-site pages cannot send this without a preflight.
    if(media&&!media[2]&&request.method==='POST'){
      if(!/^image\/(png|jpeg|webp|gif)$/.test(request.headers.get('content-type')??''))return json({error:'Paste a PNG, JPEG, WebP or GIF image.'},415);
      if(Number(request.headers.get('content-length')??0)>MAX_MEDIA_BYTES)return json({error:'Images must be smaller than 25 MB.'},413);
      try{const saved=await documents.saveMedia(media[1],new Uint8Array(await request.arrayBuffer()),request.headers.get('content-type')!);sync.changed();return json(saved);}
      catch(error){return json({error:error instanceof Error?error.message:'This image could not be added.'},400);}
    }
    if(url.pathname.startsWith('/api/')){
      if(request.method==='POST'&&request.headers.get('content-type')!=='application/json')return json({error:'Expected a JSON request.'},415);
      try{
        const input=request.method==='POST'&&!url.pathname.startsWith('/api/custom/')?await request.json() as any:{};
        if(url.pathname==='/api/spelling'&&request.method==='POST'){
          if(typeof input.text!=='string'||input.text.length>200000)throw Error('Choose a shorter passage to check.');
          return json(await spelling.request({text:input.text}));
        }
        if(url.pathname==='/api/spelling/suggestions'&&request.method==='POST'){
          if(typeof input.word!=='string'||input.word.length>100)throw Error('Choose a word to check.');
          return json(await spelling.request({word:input.word}));
        }
        if(url.pathname==='/api/library'&&request.method==='GET')return json(await documents.load());
        if(url.pathname==='/api/drafts/save'&&request.method==='POST'){const result=await documents.save(input.draft,typeof input.seen==='number'?input.seen:undefined);sync.changed();return json({saved:true,...result});}
        // Drafts sync changed since the window last asked.
        if(url.pathname==='/api/library/changes'&&request.method==='GET')return json({...await documents.changesSince(Number(url.searchParams.get('since')??0)||0),sync:sync.status()});
        if(url.pathname==='/api/drafts/active'&&request.method==='POST'){await documents.setActive(String(input.id??''));return json({saved:true});}
        if(url.pathname==='/api/drafts/archive'&&request.method==='POST'){await documents.archive(String(input.id??''));sync.changed();return json({archived:true});}
        if(url.pathname==='/api/drafts/delete'&&request.method==='POST'){await documents.delete(String(input.id??''));sync.changed();return json({deleted:true});}
        if(url.pathname==='/api/drafts/restore'&&request.method==='POST'){const draft=await documents.restoreLast();sync.changed();return json({draft});}
        if(url.pathname==='/api/sync'&&request.method==='GET')return json(sync.status());
        if(url.pathname==='/api/sync/sign-in'&&request.method==='POST')return json(await sync.signIn());
        if(url.pathname==='/api/sync/workspaces'&&request.method==='GET')return json(await sync.workspaces());
        if(url.pathname==='/api/sync/workspace'&&request.method==='POST')return json(await sync.chooseWorkspace(input.id));
        if(url.pathname==='/api/sync/connect'&&request.method==='POST')return json(await sync.connect({credentials:input.credentials}));
        if(url.pathname==='/api/sync/folders'&&request.method==='POST')return json(await sync.folders(input.path));
        if(url.pathname==='/api/sync/folders/create'&&request.method==='POST')return json(await sync.createFolder(input.parent,input.name));
        if(url.pathname==='/api/sync/folder'&&request.method==='POST')return json(await sync.chooseFolder(input.path));
        if(url.pathname==='/api/sync/now'&&request.method==='POST')return json(sync.syncNow());
        if(url.pathname==='/api/sync/disconnect'&&request.method==='POST')return json(await sync.disconnect());
        if(url.pathname==='/api/drafts/history/load'&&request.method==='POST')return json({history:await documents.history(String(input.id??''),String(input.versionId??''))});
        if(url.pathname==='/api/drafts/history'&&request.method==='POST'){await documents.saveHistory(String(input.id??''),String(input.versionId??''),input.history);return json({saved:true});}
        if(url.pathname==='/api/images/copy'&&request.method==='POST'){await copyImageFile(documents.mediaPath(String(input.id??''),String(input.src??'').replace(/^media\//,'')));return json({copied:true});}
        if(url.pathname==='/api/features'&&request.method==='GET')return json(updates.view());
        if(url.pathname==='/api/preferences'&&request.method==='GET')return json(preferences);
        if(url.pathname==='/api/preferences'&&request.method==='POST'){
          for(const key of ['menuBarIcon','openAtLogin'] as const)if(typeof input[key]==='boolean')preferences[key]=input[key];
          await atomicWrite(preferencesPath,JSON.stringify(preferences,null,2)+'\n');return json(preferences);
        }
        if(url.pathname==='/api/health')return json({version:updates.active.id,recoveryCounter,closeReady,restartRequested,preferences,...(restartRequested?{nativeInstallPlan:updates.state.nativeInstallPlan}:{})});
        if(url.pathname==='/api/links/open'&&request.method==='POST'){await openExternalLink(input.url);return json({opened:true});}
        if(url.pathname==='/api/close/ready'&&request.method==='POST'){closeReady=true;return json({ready:true});}
        if(url.pathname==='/api/close/reset'&&request.method==='POST'){closeReady=false;return json({ready:false});}
        if(url.pathname==='/api/providers'&&request.method==='GET'){const providers=await updates.providers(url.searchParams.has('refresh'));const selected=await updates.defaultSelection();return json({providers,selection:selected});}
        if(url.pathname==='/api/providers/select'&&request.method==='POST'){await updates.select(input as AgentSelection);return json({saved:true});}
        if(url.pathname==='/api/providers/login'&&request.method==='POST'){if(!['claude','codex'].includes(input.provider))throw Error('Choose Claude Code or Codex.');return json({providers:await updates.login(input.provider)});}
        if(url.pathname==='/api/assist'&&request.method==='POST'){
          if(typeof input.prompt!=='string'||input.prompt.length>100000)throw Error('The writing request is too large.');
          const selected=await updates.defaultSelection();if(!selected)throw Error('Connect Claude Code or Codex in Model settings.');
          const response=await updates.agents.run(selected,input.prompt,{signal:request.signal,schema:writingSchema(input.kind)});await updates.rememberConnection(selected.provider);return json({response,provider:selected.provider});
        }
        if(url.pathname==='/api/updates/request'&&request.method==='POST')return json(await updates.request(input.kind as UpdateKind,String(input.request??''),input.featureId));
        if(url.pathname==='/api/updates/reconnect'&&request.method==='POST')return json(await updates.reconnect(input.id));
        if(url.pathname==='/api/features/queue'&&request.method==='POST')return json(await updates.queue(input));
        if(url.pathname==='/api/updates/discard'&&request.method==='POST'){await updates.discard(input.id);return json({discarded:true});}
        if(url.pathname==='/api/updates/apply'&&request.method==='POST'){const restart=!dev&&input.restart===true;const result=await updates.apply(input.id,restart);restartRequested=restart;return json({...result,restart});}
        if(url.pathname==='/api/updates/confirm'&&request.method==='POST'){await updates.confirm(input.version);return json({confirmed:true});}
        if(url.pathname==='/api/updates/check'&&request.method==='POST')return json(await updates.checkOfficial(input.background!==true));
        if(url.pathname==='/api/updates/resolve'&&request.method==='POST')return json(await updates.resolveOfficial(input.id,input.choices));
        if(url.pathname==='/api/updates/abort'&&request.method==='POST'){restartRequested=false;await updates.abortActivation();return json({restored:true});}
        if(url.pathname==='/api/updates/handoff'&&request.method==='POST')return json(await updates.handoff({updateId:input.updateId,featureId:input.featureId}));
        if(url.pathname==='/api/updates/handoff/check'&&request.method==='POST')return json(await updates.checkHandoff(input.id));
        if(url.pathname==='/api/reveal'&&request.method==='POST'){
          const path=input.kind==='source'?updates.active.source:input.kind==='documents'?documents.root:input.kind==='versions'?join(root,'versions'):null;
          if(!path)throw Error('Unknown folder.');spawn('/usr/bin/open',[path],{stdio:'ignore'}).unref();return json({opened:true});
        }
        if(url.pathname==='/api/external'&&request.method==='POST'){
          const addresses={claude:'https://claude.com/product/claude-code',codex:'https://developers.openai.com/codex/cli',source:'https://github.com/eabnelson/draft'};
          const address=addresses[input.kind as keyof typeof addresses];if(!address)throw Error('Unknown link.');spawn('/usr/bin/open',[address],{stdio:'ignore'}).unref();return json({opened:true});
        }
        if(url.pathname==='/api/export'&&request.method==='POST'){
          const path=await documents.export(String(input.id??''),join(root,'Exports'),plainText);spawn('/usr/bin/open',['-R',path],{stdio:'ignore'}).unref();return json({path});
        }
        if(url.pathname.startsWith('/api/custom/')){
          if(activeRuntime?.id!==updates.active.id){const path=join(updates.active.dist,'runtime.js');activeRuntime={id:updates.active.id,handler:await exists(path)?(await import(path+`?version=${updates.active.id}`)).handleRequest:null};}
          if(activeRuntime.handler){const response=await activeRuntime.handler(request);if(response)return response;}
        }
        return json({error:'Not found.'},404);
      }catch(error){return json({error:error instanceof Error?error.message:'The request failed.'},400);}
    }
    let decoded:string;try{decoded=decodeURIComponent(url.pathname);}catch{return new Response('Invalid path',{status:400});}
    const hostUI=decoded==='/updates'||decoded.startsWith('/host-ui/')||decoded==='/host-updates.js';
    const base=hostUI?join(runtime,'host-ui'):updates.active.dist;
    const path=resolve(base,decoded==='/updates'?'host-ui/index.html':decoded==='/host-updates.js'?'bridge.js':decoded.startsWith('/host-ui/')?`.${decoded.slice('/host-ui'.length)}`:decoded==='/'?'index.html':`.${decoded}`);
    if(!within(base,path)||decoded.includes('\0'))return new Response('Not found',{status:404});
    if(!await exists(path))return new Response('Not found',{status:404});
    if(decoded==='/')closeReady=false;
    const html=extname(path)==='.html';
    return new Response(html?(await Bun.file(path).text()).replace('</head>','<script src="/host-updates.js" defer></script></head>'):Bun.file(path),{headers:{...(html?{'Content-Type':'text/html; charset=utf-8'}:{}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' draft-native:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
  }
});
setInterval(()=>{void updates.recoverIfNeeded().then(recovered=>{if(recovered)recoveryCounter++;});},2000).unref();
console.log(`DRAFT_READY ${server.port}`);
if(dev)console.log(`Local app: http://127.0.0.1:${server.port}`);
process.on('SIGTERM',()=>{spelling.close();server.stop();process.exit(0);});
