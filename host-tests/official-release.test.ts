import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {ReleaseChannel} from '../desktop/official-release';

test('a newer signed preview release is offered, while forged metadata and older releases are not',async()=>{
  const keys=generateKeyPairSync('ed25519');
  let version='0.2.0-alpha.19',tamper=false;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    const origin=new URL(request.url).origin;
    if(new URL(request.url).pathname==='/releases')return Response.json([{tag_name:'v'+version,draft:false,prerelease:true,html_url:'https://github.com/eabnelson/draft/releases/tag/v'+version,assets:[{name:'draft-update.json',browser_download_url:origin+'/manifest'}]}]);
    const payload=JSON.stringify({schemaVersion:2,version,publishedAt:'2026-10-27T16:00:00Z',notes:['A clearer writing page.'],nativeHostVersion:version,source:{url:origin+'/source.tar.gz',sha256:'a'.repeat(64),size:123},desktop:{url:origin+'/app.zip',sha256:'b'.repeat(64),size:456,bundleId:'com.eriknelson.draft',arch:'arm64'}});
    return Response.json({payload:tamper?payload.replace('clearer','forged'):payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')});
  }});
  const channel=new ReleaseChannel({feed:`http://127.0.0.1:${server.port}/releases`,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),allowLocal:true,arch:'arm64',bundleId:'com.eriknelson.draft'});
  try{
    assert.equal((await channel.latest('0.2.0-alpha.18'))?.version,'0.2.0-alpha.19');
    tamper=true;await assert.rejects(channel.latest('0.2.0-alpha.18'),/verified|signature/i);
    tamper=false;version='0.2.0-alpha.17';assert.equal(await channel.latest('0.2.0-alpha.18'),undefined);
  }finally{server.stop(true);}
});
