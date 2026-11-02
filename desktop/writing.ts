export function writingSchema(kind:unknown):Record<string,unknown>|undefined{
  if(kind===undefined)return;
  if(kind==='title')return {type:'object',properties:{title:{type:'string',minLength:1,maxLength:120}},required:['title'],additionalProperties:false};
  if(kind==='summary')return {type:'object',properties:{summary:{type:'string',minLength:1,maxLength:300}},required:['summary'],additionalProperties:false};
  throw Error('Choose a writing request.');
}
