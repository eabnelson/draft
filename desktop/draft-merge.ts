// Bringing together two copies of one draft that changed apart: the copy on this Mac and the one
// in Zo. Whatever only one side changed is taken from that side. Writing is never thrown away:
// when both sides changed the same version, this Mac's text stays and Zo's becomes a new version
// beside it, named so you can tell where it came from.
import {id,type Draft,type Version} from '../src/model';

export type MergeSide={draft:Draft;metaChanged:boolean;changed:(version:Version)=>boolean};

export function mergeDrafts(local:MergeSide,remote:MergeSide,base:ReadonlySet<string>,label='from Zo'):Draft{
  const remoteById=new Map(remote.draft.versions.map(v=>[v.id,v])),localIds=new Set(local.draft.versions.map(v=>v.id));
  const kept:Version[]=[],incoming:Version[]=[];
  for(const v of local.draft.versions){
    const r=remoteById.get(v.id);
    if(r){
      const mine=local.changed(v),theirs=remote.changed(r);
      if(theirs&&!mine)kept.push({...r,number:v.number});
      else{kept.push(v);if(theirs&&r.text!==v.text&&!local.draft.versions.some(x=>x.text===r.text))incoming.push({...r,id:id(),name:`${r.name??`Version ${r.number}`} (${label})`});}
    }
    // Removed in Zo: gone here too, unless it was written in since.
    else if(!base.has(v.id)||local.changed(v))kept.push(v);
  }
  // New in Zo, or removed here but written in there since.
  for(const r of remote.draft.versions)if(!localIds.has(r.id)&&(!base.has(r.id)||remote.changed(r)))incoming.push(r);
  if(!kept.length&&!incoming.length)return local.draft;
  const used=new Set(kept.map(v=>v.number));let next=Math.max(0,...kept.map(v=>v.number),...incoming.map(v=>v.number));
  for(const v of incoming){const number=used.has(v.number)?++next:v.number;used.add(number);kept.push({...v,number});}
  const versions=kept.sort((a,b)=>a.number-b.number),ids=new Set(versions.map(v=>v.id));
  // The draft's own details (title, status, pins) come from whichever side changed them, this Mac first.
  const meta=remote.metaChanged&&!local.metaChanged?remote.draft:local.draft;
  return {...meta,versions,
    hiddenVersions:meta.hiddenVersions.filter(x=>ids.has(x)),
    publications:meta.publications.filter(p=>ids.has(p.versionId)),
    updatedAt:[local.draft.updatedAt,remote.draft.updatedAt].sort().at(-1)!};
}
