import {join,extname} from 'node:path';
import {mkdir,readFile,readdir,rename,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {atomicWrite,exists,readJSON,safeId} from './files';
import {parseDraft,toRecord,migrateLegacy,fresh,type Draft,type DraftRecord} from '../src/model';

export type Library={active:string;drafts:Draft[];archived:number};
type Index={schemaVersion:1;active:string;migratedFrom?:string};
const MEDIA_TYPES={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as const;
const CONTENT_TYPES:Record<string,string>={png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
const MEDIA_NAME=/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
export const MAX_MEDIA_BYTES=25*1024*1024;
const MAX_HISTORY_BYTES=5_000_000,MAX_VERSION_BYTES=5_000_000;

// Check the bytes, not only the declared type, before anything reaches a draft.
function signature(bytes:Uint8Array):string|null {
  const starts=(...values:number[])=>values.every((v,i)=>bytes[i]===v);
  if(starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a))return 'png';
  if(starts(0xff,0xd8,0xff))return 'jpg';
  if(starts(0x47,0x49,0x46,0x38))return 'gif';
  if(starts(0x52,0x49,0x46,0x46)&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';
  return null;
}

// Each draft is a package folder: draft.json, versions/v<n>.md, media/, and history/.
export class DraftStore {
  private queue:Promise<unknown>=Promise.resolve();
  readonly archiveRoot:string;readonly recovery:string;
  constructor(readonly root:string,readonly legacy?:string){this.archiveRoot=join(root,'Archive');this.recovery=join(root,'Recovery');}
  package(id:string,archived=false){return join(archived?this.archiveRoot:this.root,`${safeId(id)}.draft`);}
  private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.queue.then(run);this.queue=result.catch(()=>{});return result;}

  async load():Promise<Library>{
    await mkdir(this.root,{recursive:true});
    const indexPath=join(this.root,'library.json');
    if(!await exists(indexPath))await this.serial(()=>this.initialize());
    const index=await readJSON<Index>(indexPath);
    if(index.schemaVersion!==1)throw Error('Your drafts need a newer version of Draft.');
    const drafts=await this.readAll(this.root);
    if(!drafts.length){const d=fresh();await this.save(d);drafts.push(d);}
    drafts.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const archived=(await this.packages(this.archiveRoot)).length;
    return {active:drafts.some(d=>d.id===index.active)?index.active:drafts[0].id,drafts,archived};
  }
  private async packages(folder:string){
    if(!await exists(folder))return [];
    return (await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.endsWith('.draft')).map(e=>join(folder,e.name));
  }
  private async readAll(folder:string){
    const drafts:Draft[]=[];
    for(const path of await this.packages(folder)){
      // A package without draft.json is media pasted before the first save.
      if(!await exists(join(path,'draft.json')))continue;
      try{drafts.push(await this.read(path));}catch(error){console.error(`Draft skipped ${path}:`,error);}
    }
    return drafts;
  }
  async read(path:string):Promise<Draft>{
    const record=await readJSON<DraftRecord>(join(path,'draft.json'));
    const texts:Record<string,string>={};
    for(const v of Array.isArray(record.versions)?record.versions:[]){
      if(!Number.isInteger(v?.number)||typeof v.id!=='string')continue;
      try{texts[v.id]=await readFile(join(path,'versions',`v${v.number}.md`),'utf8');}catch{}
    }
    return parseDraft(record,texts);
  }
  private async initialize(){
    const index:Index={schemaVersion:1,active:''};
    if(this.legacy&&await exists(join(this.legacy,'library.json'))){
      const migrated=await this.migrate(this.legacy);index.active=migrated.active;index.migratedFrom=this.legacy;
    }
    await atomicWrite(join(this.root,'library.json'),JSON.stringify(index,null,2)+'\n');
  }
  // Draft 1 files stay where they were as the recovery copy; each becomes a package here.
  private async migrate(legacy:string):Promise<{active:string}>{
    const record=await readJSON<{active:string;drafts:string[];archived?:string[]}>(join(legacy,'library.json'));
    for(const [ids,archived] of [[record.drafts??[],false],[record.archived??[],true]] as const)for(const legacyId of ids){
      let draft:Draft;try{draft=migrateLegacy(JSON.parse(await readFile(join(legacy,`${safeId(legacyId)}.draft.json`),'utf8')));}catch{continue;}
      const target=this.package(draft.id,archived);
      for(const name of new Set([...draft.versions[0].text.matchAll(/media\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))/g)].map(m=>m[1]))){
        const source=join(legacy,'images',name);if(await exists(source))await cp(source,join(target,'media',name));
      }
      await this.write(target,draft);
    }
    return {active:record.active};
  }
  private async write(path:string,draft:Draft){
    for(const v of draft.versions){
      if(v.text.length>MAX_VERSION_BYTES)throw Error('A version is larger than the 5 MB limit.');
      const file=join(path,'versions',`v${v.number}.md`);let previous:string|undefined;try{previous=await readFile(file,'utf8');}catch{}
      if(previous===v.text)continue;
      if(previous)await atomicWrite(join(this.recovery,draft.id,`v${v.number}.previous.md`),previous);
      await atomicWrite(file,v.text);
    }
    // Versions removed from the draft keep their last text in Recovery.
    const kept=new Set(draft.versions.map(v=>`v${v.number}.md`));
    if(await exists(join(path,'versions')))for(const name of await readdir(join(path,'versions')))if(!kept.has(name)&&/^v\d+\.md$/.test(name)){
      await rename(join(path,'versions',name),join(await this.recoveryFolder(draft.id),`${Date.now()}-${name}`));
    }
    await atomicWrite(join(path,'draft.json'),JSON.stringify(toRecord(draft),null,2)+'\n');
  }
  private async recoveryFolder(id:string){const folder=join(this.recovery,safeId(id));await mkdir(folder,{recursive:true});return folder;}

  save(input:Draft):Promise<void>{
    return this.serial(async()=>{
      safeId(input?.id??'');const texts=Object.fromEntries((input.versions??[]).map(v=>[v.id,v.text]));
      const draft=parseDraft(toRecord(input),texts);
      if(await exists(this.package(draft.id,true)))throw Error('This draft is archived. Restore it before editing.');
      if(this.deleted.has(draft.id))throw Error('This draft was deleted.');
      await this.write(this.package(draft.id),draft);
    });
  }
  setActive(id:string):Promise<void>{
    return this.serial(async()=>{const path=join(this.root,'library.json'),index=await readJSON<Index>(path);await atomicWrite(path,JSON.stringify({...index,active:safeId(id)},null,2)+'\n');});
  }
  archive(id:string):Promise<void>{
    return this.serial(async()=>{const from=this.package(id);if(!await exists(from))throw Error('This draft is no longer available.');await mkdir(this.archiveRoot,{recursive:true});await rename(from,this.package(id,true));});
  }
  // Deleting moves the whole draft into Recovery, so nothing is lost by accident.
  private deleted=new Set<string>();
  delete(id:string):Promise<void>{
    return this.serial(async()=>{
      const from=this.package(id);if(!await exists(from))throw Error('This draft is no longer available.');
      const folder=join(this.recovery,'Deleted');await mkdir(folder,{recursive:true});
      await rename(from,join(folder,`${Date.now()}-${safeId(id)}.draft`));this.deleted.add(safeId(id));
    });
  }
  // Restores the most recently archived draft.
  restoreLast():Promise<Draft|null>{
    return this.serial(async()=>{
      const archived=await this.readAll(this.archiveRoot);if(!archived.length)return null;
      const last=archived.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
      await rename(this.package(last.id,true),this.package(last.id));return last;
    });
  }

  async saveMedia(id:string,bytes:Uint8Array,declared:string):Promise<{src:string}>{
    const extension=MEDIA_TYPES[declared.split(';')[0].trim().toLowerCase() as keyof typeof MEDIA_TYPES];
    if(!extension)throw Error('Paste a PNG, JPEG, WebP or GIF image.');
    if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)throw Error('Images must be smaller than 25 MB.');
    if(signature(bytes)!==extension)throw Error('This file is not a valid image.');
    // Identical images share one file within a draft.
    const name=`${createHash('sha256').update(bytes).digest('hex').slice(0,32)}.${extension}`,path=join(this.package(id),'media',name);
    if(!await exists(path))await atomicWrite(path,bytes);
    return {src:`media/${name}`};
  }
  mediaPath(id:string,name:string):{path:string;type:string}|null {
    if(!MEDIA_NAME.test(name))return null;
    return {path:join(this.package(id),'media',name),type:CONTENT_TYPES[extname(name).slice(1)]};
  }
  async mediaResponse(id:string,name:string):Promise<Response>{
    const media=this.mediaPath(id,name);
    if(!media||!await exists(media.path))return new Response('Not found',{status:404});
    return new Response(Bun.file(media.path),{headers:{'Content-Type':media.type,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }

  // Undo and redo history for each version, kept with the draft.
  async history(id:string,versionId:string):Promise<unknown>{
    const path=join(this.package(id),'history',`${safeId(versionId)}.json`);
    return await exists(path)?readJSON(path):null;
  }
  saveHistory(id:string,versionId:string,value:unknown):Promise<void>{
    const data=JSON.stringify(value);
    if(data.length>MAX_HISTORY_BYTES)return Promise.resolve();
    return this.serial(async()=>{const path=this.package(id);if(await exists(path))await atomicWrite(join(path,'history',`${safeId(versionId)}.json`),data);});
  }

  // A plain folder anyone can open: every version as Markdown and text, plus the media.
  async export(id:string,destination:string,plain:(markdown:string)=>string):Promise<string>{
    const draft=await this.read(this.package(id));
    const stem=(draft.title||'untitled').replace(/[^a-z0-9-_ ]/gi,'').trim().replace(/\s+/g,'-').toLowerCase().slice(0,60)||'untitled';
    const folder=join(destination,`${stem}-${Date.now()}`);
    await mkdir(folder,{recursive:true});
    if(await exists(join(this.package(id),'media')))await cp(join(this.package(id),'media'),join(folder,'media'),{recursive:true});
    for(const v of draft.versions){await atomicWrite(join(folder,`v${v.number}.md`),v.text);await atomicWrite(join(folder,`v${v.number}.txt`),plain(v.text));}
    await atomicWrite(join(folder,'draft.json'),JSON.stringify(toRecord(draft),null,2)+'\n');
    return folder;
  }
}
