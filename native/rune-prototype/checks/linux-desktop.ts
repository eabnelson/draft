// Exercise GLib's real Desktop Entry parser, rather than another quoting model.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {desktopEntry} from '../../../desktop/linux-desktop';
if(process.platform!=='linux')throw Error('Run this check on Linux with gio installed.');
const root=await mkdtemp(join(tmpdir(),'draft-desktop-entry-'));
try{
  const folder=join(root,'Draft café $`"\\ 100%');await mkdir(folder);
  const executable=join(folder,'draft'),result=join(root,'result');
  await writeFile(executable,'#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$DRAFT_DESKTOP_RESULT"\n',{mode:0o755});
  const args=['--profile',join(folder,'Profile $`"\\ 20%'),'--hidden'];
  const file=join(root,'draft.desktop');await writeFile(file,desktopEntry(executable,args));
  const child=Bun.spawn(['gio','launch',file],{env:{...process.env,DRAFT_DESKTOP_RESULT:result},stdout:'inherit',stderr:'inherit'});
  assert.equal(await child.exited,0);
  for(let i=0;i<100&&!await Bun.file(result).exists();i++)await Bun.sleep(10);
  assert.deepEqual((await readFile(result,'utf8')).trimEnd().split('\n'),[executable,...args]);
  assert.throws(()=>desktopEntry('/tmp/name=invalid/draft'),/equals sign/);
  assert.throws(()=>desktopEntry('/tmp/injected\nExec=bad/draft'),/equals sign|control characters/);
  if(process.argv[2]){
    // Bun 1.4.3's script resolver treats a literal backslash as a separator even
    // on Linux. Keep the package test within its supported extraction paths;
    // the real Desktop Entry parser above still checks backslash escaping.
    const relocated=join(root,'Unpacked Draft café $`" 100%'),data=join(root,'desktop-data');await cp(resolve(process.argv[2]),relocated,{recursive:true});
    await writeFile(join(relocated,'bin/draft'),'#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$DRAFT_DESKTOP_RESULT"\n',{mode:0o755});
    const env={...process.env,XDG_DATA_HOME:data,DRAFT_DESKTOP_RESULT:result};
    let install=Bun.spawn([join(relocated,'install-desktop')],{env,stdout:'inherit',stderr:'inherit'});assert.equal(await install.exited,0);
    const shortcut=join(data,'applications/com.studiofour.draft.native.desktop');await rm(result);
    const launch=Bun.spawn(['gio','launch',shortcut],{env,stdout:'inherit',stderr:'inherit'});assert.equal(await launch.exited,0);
    for(let i=0;i<100&&!await Bun.file(result).exists();i++)await Bun.sleep(10);
    assert.equal((await readFile(result,'utf8')).trimEnd(),join(relocated,'bin/draft'));
    install=Bun.spawn([join(relocated,'install-desktop'),'--uninstall'],{env,stdout:'inherit',stderr:'inherit'});assert.equal(await install.exited,0);assert.equal(await Bun.file(shortcut).exists(),false);
  }
  console.log('PASS relocated Linux desktop launcher with Unicode, spaces, quotes, backslashes, percent, and shell metacharacters');
}finally{await rm(root,{recursive:true,force:true});}
