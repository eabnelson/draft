import {fresh,cleanText,type Draft} from '../../src/model';
import type {Catalog,FeaturesState,QueuedFeature,Update} from '../../desktop/types';
import official from '../../features.json';

const clone=<T,>(value:T):T=>structuredClone(value);
export class DemoStore{
  library!: {active:string;drafts:Draft[];archived:Draft[]};
  catalog!:Catalog;queue:QueuedFeature[]=[];updates:Update[]=[];version='demo-official';generation=0;
  listeners=new Set<()=>void>();
  reset(){this.generation++;const draft=fresh();draft.title='Room to think';this.library={active:draft.id,drafts:[draft],archived:[]};this.catalog=clone(official as Catalog);this.queue=[];this.updates=[];this.version='demo-official';this.emit();}
  emit(){for(const listener of this.listeners)listener();}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  get hasReadingTime(){return this.catalog.features.some(f=>f.id==='demo-reading-time'&&f.state==='active');}
  get hasFocus(){return this.catalog.features.some(f=>f.id==='demo-focus'&&f.state==='active');}
  features():FeaturesState{return clone({official:official as Catalog,current:this.catalog,activeVersion:this.version,updates:[...this.updates].reverse(),featureQueue:this.queue,handoffs:[],sourcePath:'',documentsPath:'',appVersion:this.catalog.appVersion,nativeHostVersion:this.catalog.appVersion,demo:true});}
  async api(path:string,input?:any,signal?:AbortSignal):Promise<any>{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(path==='/api/library'){if(input){this.library=clone(input);this.emit();return {saved:true};}return clone(this.library);}
    if(path==='/api/health')return {version:this.version};
    if(path==='/api/features')return this.features();
    if(path==='/api/features/queue'){
      if(input.action==='add'){
        if(!input.request?.trim()||input.request.length>8000)throw Error('Describe the change you want.');
        if(this.queue.length>=30)throw Error('Your list is full. Remove an idea first.');
        this.queue.push({id:crypto.randomUUID(),kind:input.kind??'add',request:input.request,featureId:input.featureId,createdAt:new Date().toISOString(),selected:true});
      }else{
        const i=this.queue.findIndex(q=>q.id===input.id);if(i<0)throw Error('That idea is no longer in your list.');
        if(this.updates.some(u=>['checking','preparing','building','ready','applying'].includes(u.state)&&u.requests?.some(r=>r.id===input.id)))throw Error('Cancel this download before changing its ideas.');
        if(input.action==='remove')this.queue.splice(i,1);
        if(input.action==='select')this.queue[i].selected=input.selected;
        if(input.action==='move'&&i>0)[this.queue[i-1],this.queue[i]]=[this.queue[i],this.queue[i-1]];
      }
      this.emit();return this.features();
    }
    if(path==='/api/updates/request'){
      if(this.updates.some(u=>['checking','preparing','building','ready','applying'].includes(u.state)))throw Error('Finish or cancel your current update first.');
      const requests=input.kind==='reset'?[]:clone(this.queue.filter(q=>q.selected));
      if(input.kind!=='reset'&&!requests.length)throw Error('Add a change to your list first.');
      const now=new Date().toISOString(),u:Update={id:crypto.randomUUID(),kind:input.kind,request:requests.map(q=>q.request).join('\n'),requests,title:input.kind==='reset'?'Official Draft':`${requests.length} changes for your Draft`,createdAt:now,updatedAt:now,baseVersion:this.version,state:'preparing',stage:'Preparing',estimatedSeconds:180};
      this.updates.push(u);const generation=this.generation;
      // The editor is real; only AI generation and waiting are simulated here.
      setTimeout(()=>{if(generation!==this.generation||u.state!=='preparing')return;
        const supported=requests.every(q=>q.kind==='remove'?q.featureId?.startsWith('demo-'):/reading|read time|focus/i.test(q.request));
        if(!supported&&input.kind!=='reset'){u.state='failed';u.error='This update needs a little more work.';}
        else{u.state='ready';u.preparedAt=new Date().toISOString();u.versionId=`demo-${u.id}`;}this.emit();
      },6500);
      this.emit();return clone(u);
    }
    if(path==='/api/updates/discard'){const u=this.updates.find(u=>u.id===input.id);if(u)u.state='cancelled';this.emit();return {};}
    if(path==='/api/updates/apply'){
      const u=this.updates.find(u=>u.id===input.id);if(!u||u.state!=='ready')throw Error('This update is not ready.');
      if(u.kind==='reset')this.catalog=clone(official as Catalog);
      for(const q of u.requests??[]){
        const stamp=new Date().toISOString();
        if(q.kind==='remove'){const f=this.catalog.features.find(f=>f.id===q.featureId);if(f)f.state='removed';continue;}
        const reading=/reading|read time/i.test(q.request),id=reading?'demo-reading-time':'demo-focus';
        const feature={id,title:reading?'Reading time':'Focus mode',description:reading?'See how long your draft takes to read.':'Give your writing the whole window.',updatedAt:stamp,createdAt:stamp,origin:'personal' as const,state:'active' as const};
        this.catalog.features=this.catalog.features.filter(f=>f.id!==id);this.catalog.features.push(feature);
      }
      u.state='applying';this.version=u.versionId!;this.emit();return {version:this.version,restart:false};
    }
    if(path==='/api/updates/confirm'){
      const u=this.updates.find(u=>u.versionId===input.version&&u.state==='applying');
      if(u){u.state='applied';const ids=new Set(u.requests?.map(q=>q.id));this.queue=this.queue.filter(q=>!ids.has(q.id));this.emit();}return {};
    }
    if(path.startsWith('/api/providers'))return {providers:[],demo:true};
    if(path==='/api/assist')throw Error('Writing assistance is unavailable right now.');
    if(path==='/api/export'){
      const draft=input.draft,kind=input.kind,blob=new Blob([kind==='native'?JSON.stringify(draft,null,2):cleanText(draft)],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${draft.title}.${kind==='native'?'draft.json':kind}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {};
    }
    if(path==='/api/close/ready')return {};
    throw Error('This action is available in the Mac app.');
  }
}
