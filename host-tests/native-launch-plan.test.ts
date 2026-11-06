import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NativeUpdates,fileDigest} from '../desktop/native-update';
import {ReleaseChannel} from '../desktop/official-release';
import type {SignedRelease} from '../desktop/official-release';
import type {Update,Version} from '../desktop/types';
test('a standalone native host waits for its own process before a desktop swap',async()=>{
  const root=await mkdtemp(join(tmpdir(),'draft-native-plan-'));
  try{
    const archive=join(root,'desktop.zip');await writeFile(archive,'verified package fixture');
    const digest=await fileDigest(archive),artifact={url:'https://github.com/eabnelson/draft/releases/download/v1.1.0/package.zip',sha256:digest,size:24};
    const release:SignedRelease={schemaVersion:2,version:'1.1.0',publishedAt:new Date().toISOString(),notes:[],nativeHostVersion:'1.1.0',source:artifact,desktop:{...artifact,bundleId:'com.studiofour.draft.native',arch:'arm64'},envelope:{payload:'signed fixture',signature:'signature fixture'},releaseUrl:'https://github.com/eabnelson/draft/releases/tag/v1.1.0'};
    const catalog={schemaVersion:1 as const,appVersion:'1.0.0',name:'Draft',features:[]};
    const previous:Version={id:'old',label:'Old',source:root,dist:root,catalog,createdAt:new Date().toISOString(),officialId:'old',hostVersion:'1.0.0'};
    const next:Version={...previous,id:'new',hostVersion:'1.1.0'};
    const update:Update={id:crypto.randomUUID(),kind:'official',request:'Update',title:'Update',state:'ready',stage:'Ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),baseVersion:'old',native:{archive,release}};
    const installer=new NativeUpdates(root,join(root,'Draft.app'),new ReleaseChannel({publicKey:'unused for already-staged plan',bundleId:'com.studiofour.draft.native'}),process.pid);
    const plan=JSON.parse(await readFile(await installer.installPlan(update,next,previous),'utf8'));
    assert.equal(plan.parentPid,process.pid);assert.equal(plan.runtimePid,process.pid);
  }finally{await rm(root,{recursive:true,force:true});}
});
