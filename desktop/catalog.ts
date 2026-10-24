import type {Catalog,Feature} from './types';
export function validateCatalog(value:unknown):Catalog{
  const c=value as Catalog;if(!c||c.schemaVersion!==1||typeof c.appVersion!=='string'||typeof c.name!=='string'||!Array.isArray(c.features)||c.features.length>200)throw Error('The update has no valid feature catalog.');
  try{Bun.semver.order(c.appVersion,c.appVersion);}catch{throw Error('The update has an invalid app version.');}
  const ids=new Set<string>();for(const f of c.features){if(!f||!/^[-a-zA-Z0-9_.]{1,100}$/.test(f.id)||ids.has(f.id)||typeof f.title!=='string'||!f.title.trim()||f.title.length>150||typeof f.description!=='string'||f.description.length>1000||!Number.isFinite(Date.parse(f.updatedAt))||!['official','personal'].includes(f.origin)||!['active','removed'].includes(f.state))throw Error('The update contains an invalid feature entry.');ids.add(f.id);}
  for(const f of c.features){if(f.dependsOn?.some(id=>!ids.has(id)))throw Error('A feature depends on a missing capability.');}return c;
}
export function differences(official:Catalog,current:Catalog){
  return current.features.filter(f=>f.origin==='personal'||f.state==='removed'||(()=>{const source=official.features.find(s=>s.id===f.id);return !source||f.updatedAt!==source.updatedAt||f.description!==source.description;})());
}
export function likelyMatch(catalog:Catalog,request:string):Feature|undefined{
  const q=request.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2&&!['add','the','and','want','feature','please','can','app','draft','for','with','that'].includes(x));
  if(!q.length)return;
  return catalog.features.find(f=>f.state==='active'&&q.length>=2&&q.every(word=>`${f.title} ${f.description}`.toLowerCase().includes(word)));
}
