import {join,resolve} from 'node:path';
import {mkdir,mkdtemp,rm,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startPrototypeHost} from './host';

const root=resolve(import.meta.dir),args=process.argv.slice(2);
const shortcutCheck=args.includes('--check-shortcuts'),check=args.includes('--check')||shortcutCheck,release=args.includes('--release'),nativeArgs=args.filter(x=>!['--check','--check-shortcuts','--release'].includes(x));
const build=Bun.spawn(['cargo','build','--manifest-path',join(root,'Cargo.toml'),'--locked',...(release?['--release']:[])],{stdout:'inherit',stderr:'inherit'});
if(await build.exited)process.exit(1);
const data=check?await mkdtemp(join(tmpdir(),'draft-rune-check-')):resolve(process.env.DRAFT_RUNE_DATA_ROOT??join(root,'scratch'));
await mkdir(data,{recursive:true});await mkdir(join(root,'artifacts'),{recursive:true});
const token=crypto.randomUUID()+crypto.randomUUID();
const {server,store,close}=await startPrototypeHost(data,token,{examples:true});
let executable=join(root,`target/${release?'release':'debug'}/draft-rune-prototype`);
if(process.platform==='darwin'&&!check&&nativeArgs.every(arg=>arg==='--hidden')){
  const contents=join(root,'artifacts/Draft Rune Prototype.app/Contents');await mkdir(join(contents,'MacOS'),{recursive:true});
  await copyFile(executable,join(contents,'MacOS/draft-rune-prototype'));
  await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>draft-rune-prototype</string><key>CFBundleIdentifier</key><string>com.studiofour.draft.rune-prototype</string><key>CFBundleName</key><string>Draft Rune Prototype</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>');
  executable=join(contents,'MacOS/draft-rune-prototype');
}
let launchArgs=check?['--verify']:nativeArgs;
if(shortcutCheck){
  const script=join(data,'shortcuts.json');
  await writeFile(script,JSON.stringify([
    {t:0.05,focus:false},{t:0.1,shortcut:'alt+.'},
    {t:0.8,focus:true},{t:0.9,shortcut:'alt+.'},
    {t:1.2,focus:false},{t:1.3,shortcut:'alt+.'},
    {t:2,menu:'new-version'},{t:2.8,menu:'close-tab'},
    {t:3.5,menu:'settings'},{t:3.6,menu:'sidebar'},{t:3.8,menu:'close-tab'},
  ]));
  launchArgs=['--script',script,'--at','4.5','--tree',join(data,'tree.json')];
}
const child=Bun.spawn([executable,...launchArgs],{stdout:'inherit',stderr:'inherit',env:{...process.env,DRAFT_RUNE_HOST:`http://127.0.0.1:${server.port}`,DRAFT_RUNE_TOKEN:token,DRAFT_RUNE_DATA_ROOT:data}});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
  process.exitCode=await child.exited;
  if(shortcutCheck&&process.exitCode===0){
    const library=await store.load(),draft=library.drafts.find(d=>d.id===library.active);
    assert.equal(library.drafts.length,3,'global quick capture creates one blank draft and reuses it');
    assert.ok(draft&&isBlank(draft));
    assert.equal(draft.versions.length,2,'the native New Version menu uses the app action');
    assert.equal(draft.hiddenVersions.length,1,'the native Close Tab menu preserves writing');
    const tree=await Bun.file(join(data,'tree.json')).json() as {elements:{key?:string;role?:string}[]};
    assert.ok(tree.elements.some(e=>e.key==='draft-content'));
    assert.ok(!tree.elements.some(e=>e.key==='settings-page'),'Close Tab returns from Settings');
    assert.ok(!tree.elements.some(e=>e.key==='sidebar'||e.key==='settings-sidebar'),'the native View menu hides the Settings sidebar and preserves that choice on return');
    assert.equal(tree.elements.filter(e=>e.role==='textbox').length,1,'the blank draft is ready for typing');
    console.log('PASS registered global shortcut dispatch, quick-draft reuse, native menu actions, and Settings return');
  }
}finally{await close();if(check)await rm(data,{recursive:true,force:true});}

function isBlank(draft:{versions:{text:string}[]}){return draft.versions.every(v=>!v.text.trim());}
