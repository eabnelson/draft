import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {atomicWrite,readJSON,exists} from './files';
import {desktopEntry} from './linux-desktop';
export type DesktopPreferences={menuBarIcon:boolean;openAtLogin:boolean};
const bundleId='com.studiofour.draft.native';
const xml=(value:string)=>value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export class NativeDesktop{
  preferences:DesktopPreferences={menuBarIcon:true,openAtLogin:false};
  constructor(readonly root:string,readonly executable?:string){}
  async load(){
    try{const value=await readJSON<Partial<DesktopPreferences>>(join(this.root,'preferences.json'));for(const key of ['menuBarIcon','openAtLogin'] as const)if(typeof value[key]==='boolean')this.preferences[key]=value[key]!;}catch{}
    if(process.platform==='darwin'&&this.executable&&this.preferences.openAtLogin){
      const {file}=this.loginItem();
      if(await exists(file)){
        try{await this.associateLoginItem(file);}
        catch{console.warn('Draft couldn’t refresh its login item’s app association.');}
      }
    }
    return this.preferences;
  }
  async update(input:Partial<DesktopPreferences>){
    const next={...this.preferences};for(const key of ['menuBarIcon','openAtLogin'] as const)if(typeof input[key]==='boolean')next[key]=input[key]!;
    if(next.openAtLogin!==this.preferences.openAtLogin)await this.login(next.openAtLogin);
    await atomicWrite(join(this.root,'preferences.json'),JSON.stringify(next));this.preferences=next;return next;
  }
  private loginItem(){
    const id=`${bundleId}.${createHash('sha256').update(this.root).digest('hex').slice(0,12)}`;
    const file=process.platform==='darwin'?join(homedir(),'Library/LaunchAgents',id+'.plist'):join(process.env.XDG_CONFIG_HOME??join(homedir(),'.config'),'autostart',id+'.desktop');
    return {id,file};
  }
  private async associateLoginItem(file:string){
    // Preserve existing launch settings when adding macOS's app ownership metadata.
    const read=Bun.spawn(['/usr/bin/plutil','-convert','json','-o','-',file],{stdout:'pipe',stderr:'ignore'});
    const content=await new Response(read.stdout).text();
    if(await read.exited)throw Error('The login item could not be read.');
    const item=JSON.parse(content),value=item.AssociatedBundleIdentifiers;
    const identifiers=typeof value==='string'?[value]:Array.isArray(value)?value.filter((id:unknown)=>typeof id==='string'):[];
    if(identifiers.includes(bundleId))return;
    const change=Bun.spawn(['/usr/bin/plutil',Object.hasOwn(item,'AssociatedBundleIdentifiers')?'-replace':'-insert','AssociatedBundleIdentifiers','-json',JSON.stringify([...identifiers,bundleId]),file],{stdout:'ignore',stderr:'ignore'});
    if(await change.exited)throw Error('The login item’s app association could not be updated.');
  }
  private async login(enabled:boolean){
    if(!this.executable)throw Error('Open the packaged app to change launch at login.');
    const executable=resolve(this.executable),{id,file}=this.loginItem();
    if(!enabled){await rm(file,{force:true});return;}
    await mkdir(dirname(file),{recursive:true});
    if(process.platform==='darwin')await atomicWrite(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${id}</string><key>AssociatedBundleIdentifiers</key><array><string>${bundleId}</string></array><key>ProgramArguments</key><array>${[executable,'--profile',this.root,'--hidden'].map(v=>`<string>${xml(v)}</string>`).join('')}</array><key>RunAtLoad</key><true/></dict></plist>`);
    else{
      await atomicWrite(file,desktopEntry(executable,['--profile',this.root,'--hidden'])+'X-GNOME-Autostart-enabled=true\n');
    }
  }
}
