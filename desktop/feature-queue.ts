import type {Catalog,FeatureResult,QueuedFeature,Update} from './types';

export const batchResultSchema={type:'object',properties:{outcome:{type:'string',enum:['implemented','already_exists','failed']},title:{type:'string',maxLength:80},summary:{type:'string',maxLength:360},features:{type:'array',items:{type:'object',properties:{requestId:{type:'string'},featureId:{type:'string'},outcome:{type:'string',enum:['implemented','already_exists']}},required:['requestId','featureId','outcome'],additionalProperties:false}}},required:['outcome','title','summary','features'],additionalProperties:false};
export function parseBatchResult(text:string){
  let value;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('The agent did not return a complete update result.');}
  if(!['implemented','already_exists','failed'].includes(value.outcome)||typeof value.title!=='string'||typeof value.summary!=='string'||!Array.isArray(value.features))throw Error('The agent did not return a complete update result.');
  return value as {outcome:'implemented'|'already_exists'|'failed';title:string;summary:string;features:FeatureResult[]};
}
export function validateFeatureResults(requests:QueuedFeature[],results:FeatureResult[],catalog:Catalog,installed:Catalog){
  if(results.length!==requests.length||new Set(results.map(r=>r.requestId)).size!==requests.length)throw Error('Every requested change must be accounted for before this update is ready.');
  for(const request of requests){
    const result=results.find(r=>r.requestId===request.id);
    if(!result||!['implemented','already_exists'].includes(result.outcome)||typeof result.featureId!=='string'||(request.kind==='remove'&&result.featureId!==request.featureId))throw Error('The update did not complete every requested change.');
    const expected=request.kind==='remove'?'removed':'active';
    if(catalog.features.find(f=>f.id===result.featureId)?.state!==expected)throw Error('A requested change is missing from this update.');
    if(result.outcome==='already_exists'&&installed.features.find(f=>f.id===result.featureId)?.state!==expected)throw Error('An existing feature must already be available in your current app.');
  }
}
export function estimateSeconds(history:Update[],count:number){
  const samples=history.filter(u=>u.kind==='batch'&&u.preparedAt&&['ready','applying','applied'].includes(u.state)).slice(-8).map(u=>(Date.parse(u.preparedAt!)-Date.parse(u.createdAt))/1000/Math.max(1,u.requests?.length??1)).filter(n=>n>0&&Number.isFinite(n));
  const perFeature=samples.length?samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)]:150;
  return Math.round(Math.max(60,Math.min(3600,perFeature*count)));
}
export function timeRemaining(update:Update,now=Date.now()){
  const remaining=(update.estimatedSeconds??180)-(now-Date.parse(update.createdAt))/1000;
  if(remaining<=0)return 'Taking a little longer…';
  return remaining<60?'About a minute left':`About ${Math.ceil(remaining/60)} min left`;
}
export const locksQueue=(update:Update)=>['checking','preparing','building','ready','applying'].includes(update.state);
