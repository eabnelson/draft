export function writingSchema(kind:unknown):Record<string,unknown>|undefined{
  if(kind===undefined)return;
  if(!['alternatives','trim','review'].includes(String(kind)))throw Error('Choose a writing request.');
  const key=kind==='alternatives'?'alternatives':kind==='trim'?'cuts':'flags';
  const item=kind==='alternatives'?{type:'string',minLength:1,maxLength:10000}:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:60000},reason:{type:'string',maxLength:1000},...(kind==='review'?{replacement:{type:'string',maxLength:10000}}:{})},required:['text','reason'],additionalProperties:false};
  return {type:'object',properties:{[key]:{type:'array',maxItems:kind==='alternatives'?5:100,items:item}},required:[key],additionalProperties:false};
}
