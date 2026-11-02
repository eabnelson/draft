// The walkthrough runs the real Draft app against this in-memory stand-in for the local server.
// Nothing leaves the page: drafts live in memory, and the "AI" title and summary are canned.
import {fresh,editVersion,addVersion,renameVersion,setSummary,chooseStage,latest,type Draft} from '../../src/model';
import type {Library} from '../../src/client';
import type {Catalog,Feature,FeaturesState,QueuedFeature,Update} from '../../desktop/types';
import official from '../../features.json';

const clone=<T,>(value:T):T=>structuredClone(value);
const ago=(minutes:number)=>new Date(Date.now()-minutes*60_000).toISOString();
function dated(d:Draft,minutes:number):Draft{
  const at=ago(minutes);
  return {...d,createdAt:ago(minutes+600),updatedAt:at,versions:d.versions.map((v,i)=>({...v,createdAt:ago(minutes+600-i),updatedAt:at}))};
}
function draft(text:string,minutes:number,shape:(d:Draft)=>Draft=d=>d):Draft{
  const d=fresh();return dated(shape(editVersion(d,d.versions[0].id,text)),minutes);
}

// What the tour types, and what the stand-in AI answers once there is enough of it. The
// walkthrough is Erik showing how he writes: a brain dump, then new versions, refining a few.
export const TOUR={
  dump:"hi, I'm Erik\n\nthis is how I like to write. I start with a brain dump: every thought, out of order, no fixing typos or worrying if it's any good. half sentences are fine, it just needs to get out of my head. once it's down I make new versions and shape them side by side until one feels right.",
  clean:"Hi, I'm Erik. I start every post with a brain dump, then shape it into new versions side by side.",
  cleanName:'Clean',
  short:'Brain dump first. Versions second.',
  shortName:'Short',
  cleanMore:' Then I post the one that feels right.',
  shortMore:' Post the best one.',
  request:'Show a daily word goal in my tabs',
  goal:300,
  title:'How I write',
  summary:"Erik's process: dump every thought first, then shape new versions side by side until one is ready to post.",
};

export function seedLibrary():Library{
  const tiny=draft('Tiny software is having a moment. The apps I open every day do one thing, and they do it well.\n\nBig platforms try to be everything. Small apps get to be good.',95,d=>{
    const second=addVersion(d,d.versions[0].id);
    const named=renameVersion(renameVersion(editVersion(second.draft,second.version.id,'Small apps get to be good. Big platforms have to be everything.'),second.version.id,'Punchier'),d.versions[0].id,'First');
    return setSummary({...named,title:'Tiny software',titleSource:'ai'},'Why single-purpose apps feel better to use than all-in-one platforms.',40);
  });
  const shipping=draft('I shipped 50 updates in 50 days. Here is what actually mattered.\n\nNobody noticed the polish. Everybody noticed when something was fast.',60*26,d=>({
    ...setSummary({...d,title:'Shipping daily',titleSource:'ai'},'Lessons from shipping daily: speed gets noticed, polish mostly does not.',30),
    publications:[{id:crypto.randomUUID(),platform:'x',url:'https://x.com/',versionId:d.versions[0].id,publishedAt:ago(60*25),text:latest(d).text}],
  }));
  const publicNotes=draft('Writing in public is mostly about showing up. The first hundred posts are practice.',60*52,d=>chooseStage({...d,title:'Writing in public',titleSource:'manual'},'ready'));
  const pages=draft('Morning pages, but for product ideas.',60*80,d=>({...d,title:'Morning pages',titleSource:'manual'}));
  const drafts=[tiny,shipping,publicNotes,pages];
  return {active:tiny.id,drafts,archived:0};
}

// The feature the walkthrough asks for. Once it is applied, main.tsx shows it in the tabs.
export const GOAL_FEATURE='demo-word-goal';

export class DemoStore{
  library!:Library;
  official=clone(official as Catalog);catalog=clone(official as Catalog);
  queue:QueuedFeature[]=[];updates:Update[]=[];version='demo';
  reset(){this.library=seedLibrary();this.catalog=clone(this.official);this.queue=[];this.updates=[];this.version='demo';}
  get hasGoal(){return this.catalog.features.some(f=>f.id===GOAL_FEATURE&&f.state==='active');}
  private save(d:Draft){const at=this.library.drafts.findIndex(x=>x.id===d.id);if(at<0)this.library.drafts.unshift(clone(d));else this.library.drafts[at]=clone(d);}
  features():FeaturesState{
    return clone({official:this.official,current:this.catalog,activeVersion:this.version,updates:[...this.updates].reverse(),featureQueue:this.queue,handoffs:[],sourcePath:'',documentsPath:'',appVersion:this.official.appVersion,nativeHostVersion:this.official.appVersion,demo:true});
  }
  // The walkthrough decides when the "build" is done, so pausing it pauses the build too.
  finishUpdate(){const u=this.updates.find(u=>u.state==='building');if(u){u.state='ready';u.preparedAt=new Date().toISOString();u.versionId=`demo-${u.id}`;}}
  async api(path:string,input?:any):Promise<unknown>{
    switch(path){
      case '/api/library':return clone(this.library);
      case '/api/health':return {version:this.version,preferences:{}};
      case '/api/drafts/save':this.save(input.draft);return {saved:true};
      case '/api/drafts/active':this.library.active=String(input.id);return {saved:true};
      case '/api/drafts/history':return {saved:true};
      case '/api/drafts/history/load':return {history:null};
      case '/api/features':return this.features();
      case '/api/features/queue':{
        if(input.action==='add'){
          if(!String(input.request??'').trim())throw Error('Describe the change you want.');
          this.queue.push({id:crypto.randomUUID(),kind:input.kind??'add',request:input.request,featureId:input.featureId,createdAt:new Date().toISOString(),selected:true});
        }else{
          const at=this.queue.findIndex(q=>q.id===input.id);if(at<0)throw Error('That idea is no longer in your list.');
          if(input.action==='remove')this.queue.splice(at,1);
          if(input.action==='select')this.queue[at].selected=input.selected;
          if(input.action==='move'&&at>0)[this.queue[at-1],this.queue[at]]=[this.queue[at],this.queue[at-1]];
        }
        return this.features();
      }
      case '/api/updates/request':{
        if(this.updates.some(u=>['building','ready','applying'].includes(u.state)))throw Error('Finish or cancel your current update first.');
        const requests=clone(this.queue.filter(q=>q.selected));if(!requests.length)throw Error('Add a change to your list first.');
        const now=new Date().toISOString(),u:Update={id:crypto.randomUUID(),kind:'batch',request:requests.map(q=>q.request).join('\n'),requests,title:`${requests.length} ${requests.length===1?'change':'changes'} for your Draft`,createdAt:now,updatedAt:now,baseVersion:this.version,state:'building',stage:'Building',estimatedSeconds:40};
        this.updates.push(u);return clone(u);
      }
      case '/api/updates/discard':{const u=this.updates.find(u=>u.id===input.id);if(u)u.state='cancelled';return {};}
      case '/api/updates/apply':{
        const u=this.updates.find(u=>u.id===input.id);if(!u||u.state!=='ready')throw Error('This update is not ready.');
        const now=new Date().toISOString(),feature:Feature={id:GOAL_FEATURE,title:'Word goal',description:`Shows your words toward a ${TOUR.goal}-word goal in the tab you are in.`,createdAt:now,updatedAt:now,origin:'personal',state:'active'};
        this.catalog.features=[...this.catalog.features.filter(f=>f.id!==GOAL_FEATURE),feature];
        u.state='applying';this.version=u.versionId!;return {version:this.version,restart:false};
      }
      case '/api/updates/confirm':{
        const u=this.updates.find(u=>u.versionId===input.version&&u.state==='applying');
        if(u){u.state='applied';const ids=new Set(u.requests?.map(q=>q.id));this.queue=this.queue.filter(q=>!ids.has(q.id));}
        return {};
      }
      case '/api/updates/check':return {available:false,message:'You’re up to date.'};
      case '/api/close/ready':return {};
      case '/api/preferences':return {};
      case '/api/spelling':return {available:false,words:[]};
      case '/api/spelling/suggestions':return {suggestions:[]};
      case '/api/assist':{
        // Stands in for the connected AI: a title once the draft is long enough, then a summary.
        const kind=input?.kind,response=kind==='title'?{title:TOUR.title}:kind==='summary'?{summary:TOUR.summary}:null;
        if(!response)throw Error('Writing help is available in the Mac app.');
        return {response:JSON.stringify(response)};
      }
    }
    throw Error('This works in the Mac app.');
  }
}
