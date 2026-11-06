import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {atomicWrite,readJSON} from './files';
import {desktopEntry} from './linux-desktop';
export type DesktopPreferences={menuBarIcon:boolean;openAtLogin:boolean};
const xml=(value:string)=>value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export class NativeDesktop{
  preferences:DesktopPreferences={menuBarIcon:true,openAtLogin:false};
  constructor(readonly root:string,readonly executable?:string){}
  async load(){try{const value=await readJSON<Partial<DesktopPreferences>>(join(this.root,'preferences.json'));for(const key of ['menuBarIcon','openAtLogin'] as const)if(typeof value[key]==='boolean')this.preferences[key]=value[key]!;}catch{}return this.preferences;}
  async update(input:Partial<DesktopPreferences>){
    const next={...this.preferences};for(const key of ['menuBarIcon','openAtLogin'] as const)if(typeof input[key]==='boolean')next[key]=input[key]!;
    if(next.openAtLogin!==this.preferences.openAtLogin)await this.login(next.openAtLogin);
    await atomicWrite(join(this.root,'preferences.json'),JSON.stringify(next));this.preferences=next;return next;
  }
  private async login(enabled:boolean){
    if(!this.executable)throw Error('Open the packaged app to change launch at login.');
    const executable=resolve(this.executable),id=`com.studiofour.draft.native.${createHash('sha256').update(this.root).digest('hex').slice(0,12)}`;
    const file=process.platform==='darwin'?join(homedir(),'Library/LaunchAgents',id+'.plist'):join(process.env.XDG_CONFIG_HOME??join(homedir(),'.config'),'autostart',id+'.desktop');
    if(!enabled){await rm(file,{force:true});return;}
    await mkdir(dirname(file),{recursive:true});
    if(process.platform==='darwin')await atomicWrite(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${id}</string><key>ProgramArguments</key><array>${[executable,'--profile',this.root,'--hidden'].map(v=>`<string>${xml(v)}</string>`).join('')}</array><key>RunAtLoad</key><true/></dict></plist>`);
    else{
      await atomicWrite(file,desktopEntry(executable,['--profile',this.root,'--hidden'])+'X-GNOME-Autostart-enabled=true\n');
    }
  }
}
