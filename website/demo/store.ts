// The walkthrough runs the real Draft app against this in-memory stand-in for the local server.
// Nothing leaves the page: drafts live in memory, and the "AI" title and summary are canned.
import {fresh,editVersion,addVersion,renameVersion,setSummary,chooseStage,latest,type Draft} from '../../src/model';
import type {Library} from '../../src/client';

const clone=<T,>(value:T):T=>structuredClone(value);
const ago=(minutes:number)=>new Date(Date.now()-minutes*60_000).toISOString();
function dated(d:Draft,minutes:number):Draft{
  const at=ago(minutes);
  return {...d,createdAt:ago(minutes+600),updatedAt:at,versions:d.versions.map((v,i)=>({...v,createdAt:ago(minutes+600-i),updatedAt:at}))};
}
function draft(text:string,minutes:number,shape:(d:Draft)=>Draft=d=>d):Draft{
  const d=fresh();return dated(shape(editVersion(d,d.versions[0].id,text)),minutes);
}

// What the tour types, and what the stand-in AI answers once there is enough of it.
export const TOUR={
  first:'Most ideas die in the notes app. Not because they are bad, but because there is nowhere for them to go next. Draft gives every idea a place to grow. Write it down, try another version right beside it, and keep track of where each one went live. Small ideas turn into posts when they have room.',
  short:'Ideas die in the notes app. Draft gives them somewhere to go.',
  versionName:'Short take',
  title:'Give every idea somewhere to go',
  summary:'Why ideas stall in notes apps, and how a place to version and publish them helps.',
};

export function seedLibrary():Library{
  const tiny=draft('Tiny software is having a moment. The apps I open every day do one thing, and they do it well.\n\nBig platforms try to be everything. Small apps get to be good.',95,d=>{
    const second=addVersion(d,d.versions[0].id);
    const named=renameVersion(editVersion(second.draft,second.version.id,'Small apps get to be good. Big platforms have to be everything.'),second.version.id,'Punchier');
    return setSummary({...named,title:'The case for tiny software',titleSource:'ai'},'Why single-purpose apps feel better to use than all-in-one platforms.',40);
  });
  const shipping=draft('I shipped 50 updates in 50 days. Here is what actually mattered.\n\nNobody noticed the polish. Everybody noticed when something was fast.',60*26,d=>({
    ...setSummary({...d,title:'50 updates in 50 days',titleSource:'ai'},'Lessons from shipping daily: speed gets noticed, polish mostly does not.',30),
    publications:[{id:crypto.randomUUID(),platform:'x',url:'https://x.com/',versionId:d.versions[0].id,publishedAt:ago(60*25),text:latest(d).text}],
  }));
  const publicNotes=draft('Writing in public is mostly about showing up. The first hundred posts are practice.',60*52,d=>chooseStage({...d,title:'Notes on writing in public',titleSource:'manual'},'ready'));
  const pages=draft('Morning pages, but for product ideas.',60*80);
  const drafts=[tiny,shipping,publicNotes,pages];
  return {active:tiny.id,drafts,archived:0};
}

export class DemoStore{
  library!:Library;
  reset(){this.library=seedLibrary();}
  private save(d:Draft){const at=this.library.drafts.findIndex(x=>x.id===d.id);if(at<0)this.library.drafts.unshift(clone(d));else this.library.drafts[at]=clone(d);}
  async api(path:string,input?:any):Promise<unknown>{
    switch(path){
      case '/api/library':return clone(this.library);
      case '/api/health':return {version:'demo',preferences:{}};
      case '/api/drafts/save':this.save(input.draft);return {saved:true};
      case '/api/drafts/active':this.library.active=String(input.id);return {saved:true};
      case '/api/drafts/history':return {saved:true};
      case '/api/drafts/history/load':return {history:null};
      case '/api/features':return {updates:[],featureQueue:[],handoffs:[],demo:true};
      case '/api/updates/check':return {available:false,message:'You’re up to date.'};
      case '/api/updates/confirm':case '/api/close/ready':return {};
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
