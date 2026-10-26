import {resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dir,'dist');
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.DRAFT_WEBSITE_PORT??4320),async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  let pathname;try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Not found',{status:404});}
  // Local browser checks exercise layout against the built site without shipping
  // test pages in the static website output.
  if(pathname==='/__checks__/resize.html')return new Response(Bun.file(resolve(import.meta.dir,'../tests/fixtures/website-resize.html')),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  if(pathname==='/__checks__/walkthrough.html')return new Response(Bun.file(resolve(import.meta.dir,'../tests/fixtures/website-walkthrough.html')),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  if(pathname.endsWith('/'))pathname+='index.html';const path=resolve(root,`.${pathname}`);
  if(!path.startsWith(root+sep)||pathname.includes('\0')||!await Bun.file(path).exists())return new Response('Not found',{status:404});
  const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.mp4':'video/mp4','.txt':'text/plain'};
  return new Response(request.method==='HEAD'?null:Bun.file(path),{headers:{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'"}});
}});
console.log(`Draft website: http://127.0.0.1:${server.port}/`);
