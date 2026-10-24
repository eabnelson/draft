import {join} from 'node:path';
const pages:Record<string,string>={'/':'index.html','/index.html':'index.html','/assets/mark.svg':'assets/mark.svg','/assets/icon.svg':'assets/icon.svg'};
const server=Bun.serve({hostname:'127.0.0.1',port:4320,fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const file=pages[new URL(request.url).pathname];
  if(!file)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:Bun.file(join(import.meta.dir,file)),{headers:{'Content-Type':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}});
console.log(`Draft website: http://127.0.0.1:${server.port}/`);
