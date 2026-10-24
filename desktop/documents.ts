import {join} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {atomicWrite,exists,readJSON,safeId} from './files';
import {parseDraft,fresh,type Draft} from '../src/model';

export type Library={active:string;drafts:Draft[];archived?:Draft[]};
export class DocumentStore {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly root:string){}
  async load():Promise<Library>{
    await mkdir(this.root,{recursive:true});const index=join(this.root,'library.json');
    if(!await exists(index)){const d=fresh(true);await this.save({active:d.id,drafts:[d]});}
    const record=await readJSON<{version:number;active:string;drafts:string[];archived:string[]}>(index);
    if(record.version!==1)throw Error('This document library needs a newer version of Draft.');
    const load=async(id:string)=>parseDraft(await readFile(join(this.root,`${safeId(id)}.draft.json`),'utf8'));
    return {active:record.active,drafts:await Promise.all(record.drafts.map(load)),archived:await Promise.all((record.archived??[]).map(load))};
  }
  save(input:Library):Promise<void>{
    const run=async()=>{
      if(!input||!Array.isArray(input.drafts)||!input.drafts.length||!input.drafts.some(d=>d.id===input.active))throw Error('The document library is invalid.');
      const all=[...input.drafts,...input.archived??[]];if(all.length>5000)throw Error('This library has too many documents.');
      const ids=new Set<string>();
      const drafts=all.map(d=>{safeId(d.id);if(ids.has(d.id))throw Error('Duplicate document identity.');ids.add(d.id);return parseDraft(JSON.stringify(d));});
      // Files are written before the index; orphaned versions remain recoverable.
      for(const draft of drafts){const path=join(this.root,`${draft.id}.draft.json`);const data=JSON.stringify(draft,null,2)+'\n';
        let previous:string|undefined;try{previous=await readFile(path,'utf8');}catch{}
        if(previous===data)continue;
        if(previous)await atomicWrite(join(this.root,'recovery',`${draft.id}.previous.draft.json`),previous);
        await atomicWrite(path,data);
      }
      await atomicWrite(join(this.root,'library.json'),JSON.stringify({version:1,active:input.active,drafts:input.drafts.map(d=>d.id),archived:(input.archived??[]).map(d=>d.id)},null,2)+'\n');
    };
    const result=this.queue.then(run);this.queue=result.catch(()=>{});return result;
  }
}
