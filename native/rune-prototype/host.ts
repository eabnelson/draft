// Disposable native-editor experiment. Reuse Draft's real file format and store.
import {join,resolve} from 'node:path';
import {DraftStore} from '../../desktop/documents';
import {fresh,addVersion,editVersion,rename,inboxOrder,isEmpty,type Draft} from '../../src/model';
import {draftAction,saveSnapshot,type DraftAction} from './actions';
import {ZoSync} from '../../desktop/zo-sync';

export async function startPrototypeHost(root:string,token:string){
  const store=new DraftStore(join(resolve(root),'Drafts'));
  // The sync engine keys credentials by data root. The prototype never borrows
  // the installed app's account or connects until the person chooses to.
  const sync=new ZoSync(resolve(root),store);
  await sync.initialize();
  const library=await store.load();
  if(library.drafts.length===1&&library.drafts[0].versions.every(v=>!v.text)){
    let d=rename(library.drafts[0],'A little room to think');
    d=editVersion(d,d.versions[0].id,'# A little room to think\n\nThe first version is for finding the thought. The next one is for finding the words.\n\nYou do not need to get it right in one pass. Leave the first draft beside you, and try the sentence another way.\n\n**Keep the thought. Change the words.**\n\nA few things to try:\n\n- Select a phrase and make it italic.\n- Write in each version, then undo in just one.\n- Paste an image from your clipboard.\n\nWriting should feel immediate. Saving should stay out of the way.');
    const next=addVersion(d);d=editVersion(next.draft,next.version.id,'# Make room for the next version\n\nGood writing needs room to change.\n\nKeep the first version in sight. Try a shorter opening. Cut the sentence you were keeping just because it took a while to write.\n\n**Nothing has to disappear for something better to arrive.**\n\nThis is a separate native editor experiment. Your writing here lives in a disposable Draft library.');
    await store.save(d);
    let second=rename(fresh(),'A note for later');second=editVersion(second,second.versions[0].id,'# A note for later\n\nSome thoughts need a little more time.\n\nCome back to this one when you are ready.');const paired=addVersion(second);await store.save(paired.draft);
    await store.setActive(d.id);
  }
  const server=Bun.serve({hostname:'127.0.0.1',port:0,maxRequestBodySize:26*1024*1024,async fetch(request){
    if(request.headers.get('authorization')!==`Bearer ${token}`)return new Response('Unauthorized',{status:401});
    const url=new URL(request.url);
    try{
      if(request.method==='GET'&&url.pathname==='/library'){const library=await store.load();return Response.json({...library,drafts:inboxOrder(library.drafts)});}
      if(request.method==='POST'&&url.pathname==='/active'){
        const {id}=await request.json() as {id:string};
        const library=await store.load();if(!library.drafts.some(d=>d.id===id))throw Error('That draft is no longer available.');
        await store.setActive(id);return Response.json({active:id});
      }
      if(request.method==='GET'&&url.pathname==='/sync')return Response.json(sync.status());
      if(request.method==='GET'&&url.pathname==='/sync/workspaces')return Response.json(await sync.workspaces());
      if(request.method==='POST'&&url.pathname.startsWith('/sync/')){
        const input=await request.json() as {id?:string;path?:string};
        switch(url.pathname){
          case '/sync/sign-in':return Response.json(await sync.signIn());
          case '/sync/workspace':return Response.json(await sync.chooseWorkspace(input.id));
          case '/sync/folder':return Response.json(await sync.chooseFolder(input.path));
          case '/sync/now':return Response.json(sync.syncNow());
          case '/sync/disconnect':return Response.json(await sync.disconnect());
        }
      }
      if(request.method==='POST'&&url.pathname==='/save'){
        const {draft}=await request.json() as {draft:Draft};
        await saveSnapshot(store,draft);sync.changed();return Response.json({saved:true});
      }
      if(request.method==='POST'&&url.pathname==='/action'){
        const {draft,action}=await request.json() as {draft:Draft;action:DraftAction};
        const result=await draftAction(store,draft,action);sync.changed();return Response.json(result);
      }
      if(request.method==='POST'&&url.pathname==='/restore'){
        const draft=await store.restoreLast();if(draft)await store.setActive(draft.id);
        sync.changed();
        return Response.json(await store.load());
      }
      if(request.method==='POST'&&url.pathname==='/new'){
        const library=await store.load();
        const recent=[...library.drafts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
        const draft=recent&&isEmpty(recent)?recent:fresh();
        if(draft!==recent){await store.save(draft);sync.changed();}
        await store.setActive(draft.id);return Response.json(await store.load());
      }
      const media=url.pathname.match(/^\/media\/([a-zA-Z0-9._-]+)$/);
      if(request.method==='POST'&&media){return Response.json(await store.saveMedia(media[1],new Uint8Array(await request.arrayBuffer()),request.headers.get('content-type')??''));}
      return new Response('Not found',{status:404});
    }catch(error){return Response.json({error:error instanceof Error?error.message:String(error)},{status:400});}
  }});
  return {server,store,close:async()=>{await sync.close();server.stop(true);}};
}
