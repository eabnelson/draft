export function parseWritingResult(response:unknown):Record<string,unknown>{
  if(typeof response!=='string')throw Error('The model returned an unreadable response. Try again.');
  const raw=response.trim(),fenced=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  try{const value=JSON.parse(fenced?fenced[1]:raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{throw Error('The model returned an unreadable response. Try again.');}
}
