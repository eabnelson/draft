import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {desktopEntry} from '../../desktop/linux-desktop';

const app=await realpath(resolve(import.meta.dir,'../..'));
const folder=join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'applications');
const file=join(folder,'com.studiofour.draft.native.desktop');
if(process.argv.includes('--uninstall')){
  await rm(file,{force:true});console.log(`Removed desktop shortcut: ${file}`);
}else{
  const entry=desktopEntry(join(app,'bin/draft'),[],join(app,'share/icons/hicolor/512x512/apps/com.studiofour.draft.native.png'));
  await mkdir(folder,{recursive:true});await writeFile(file,entry,{mode:0o644});console.log(`Installed desktop shortcut: ${file}`);
}
