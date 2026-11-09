import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveMacDownload,downloadFallback,resolveLinuxRelease,linuxFallback} from '../website/download';

test('the website downloads the newest published Mac installer and ignores an unfinished release',()=>{
 const release=(version:string,draft=false)=>({tag_name:'v'+version,draft,assets:[{name:`Draft-${version}-macos-arm64.dmg`,browser_download_url:`https://github.com/eabnelson/draft/releases/download/v${version}/Draft-${version}-macos-arm64.dmg`}]});
 assert.equal(resolveMacDownload([release('0.2.0-alpha.20',true),release('0.2.0-alpha.18'),release('0.2.0-alpha.19')]),'https://github.com/eabnelson/draft/releases/download/v0.2.0-alpha.19/Draft-0.2.0-alpha.19-macos-arm64.dmg');
 assert.equal(resolveMacDownload([{...release('0.2.0-alpha.20'),assets:[{name:'Draft-0.2.0-alpha.20-macos-arm64.dmg',browser_download_url:'https://example.com/untrusted.dmg'}]}]),downloadFallback);
 assert.equal(resolveMacDownload([]),downloadFallback);
});

test('the website links the newest published release that has both Linux builds',()=>{
 const release=(version:string,arches=['x64','arm64'],draft=false)=>({tag_name:'v'+version,draft,html_url:`https://github.com/eabnelson/draft/releases/tag/v${version}`,assets:arches.map(arch=>({name:`Draft-${version}-linux-${arch}.tar.gz`,browser_download_url:`https://github.com/eabnelson/draft/releases/download/v${version}/Draft-${version}-linux-${arch}.tar.gz`}))});
 assert.equal(resolveLinuxRelease([release('0.3.0-alpha.74',undefined,true),release('0.3.0-alpha.73',['x64']),release('0.3.0-alpha.72')]),'https://github.com/eabnelson/draft/releases/tag/v0.3.0-alpha.72');
 assert.equal(resolveLinuxRelease([{...release('0.3.0-alpha.72'),html_url:'https://example.com/elsewhere'}]),linuxFallback);
 assert.equal(resolveLinuxRelease([]),linuxFallback);
});
