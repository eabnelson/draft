import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startPrototypeHost} from '../native/rune-prototype/host';
import {editVersion} from '../src/model';

test('native host isolates preferences/history and merges a remote edit with stale typing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'draft-native-host-'));
  const host=await startPrototypeHost(root,'test-token');
  const request=async(path:string,body?:unknown)=>{
    const response=await fetch(`http://127.0.0.1:${host.server.port}${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer test-token','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,200);return response.json() as Promise<any>;
  };
  try{
    assert.equal((await fetch(`http://127.0.0.1:${host.server.port}/library`)).status,401);
    const initial=await request('/library');assert.equal(initial.drafts.length,1);
    const draft=initial.drafts[0],vid=draft.versions[0].id;
    assert.equal(draft.versions[0].text,'','a packaged app starts with a blank draft');
    await request('/save',{draft:editVersion(draft,vid,'One\n\nTwo\n'),seen:initial.seq});
    const base=(await request('/library')).drafts[0];
    await host.store.saveHistory(draft.id,vid,{codemirror:true});
    await host.store.writeExternal(editVersion(base,vid,'Remote\n\nTwo\n'),'live');
    const changes=await request('/changes?since=0');assert.equal(changes.changes.length,1);
    const saved=await request('/save',{draft:editVersion(base,vid,'One\n\nLocal\n'),seen:0,histories:{[vid]:{format:'test'}}});
    assert.ok(saved.draft,'a stale native save returns the merged draft');
    const writing=saved.draft.versions.map((v:{text:string})=>v.text).join("\n");
    assert.match(writing,/Remote/);assert.match(writing,/Local/);
    assert.deepEqual(await host.store.history(draft.id,vid),{codemirror:true});
    assert.deepEqual((await request('/library')).histories[`${draft.id}/${vid}`],{format:'test'});
    const current=(await request('/library')).drafts[0];
    await host.store.removeExternal(draft.id);
    const recovered=await request('/save',{draft:editVersion(current,vid,'Typed while sync removed this draft.'),seen:saved.seq});
    assert.equal(recovered.restored,true);assert.equal(await host.store.place(draft.id),'live');
    assert.equal((await host.store.read(host.store.package(draft.id))).versions[0].text,'Typed while sync removed this draft.');
    await request('/session',{schema_version:1,appearance:'light',scrolls:{example:[0,320]}});
    assert.equal((await request('/session')).appearance,'light');
  }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
