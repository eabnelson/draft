// Desktop Entry values are decoded before Exec argument quoting is decoded.
// https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html
export const desktopValue=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t');
export function desktopArgument(value:string){
  if(/[\x00-\x1f\x7f]/.test(value))throw Error('A desktop launcher path cannot contain control characters.');
  return desktopValue('"'+value.replace(/[%"`$\\]/g,c=>c==='%'?'%%':'\\'+c)+'"');
}
export function desktopEntry(executable:string,args:string[]=[],icon?:string){
  if(executable.includes('='))throw Error('Move Draft to a folder without an equals sign before creating its desktop shortcut.');
  // GLib probes the first executable before expanding %% in its path. Keep the
  // movable path as env's argument so folders containing percent signs work too.
  return `[Desktop Entry]\nType=Application\nName=Draft\nExec=/usr/bin/env -- ${[executable,...args].map(desktopArgument).join(' ')}\n${icon?`Icon=${desktopValue(icon)}\n`:''}Terminal=false\nCategories=Office;TextEditor;\nStartupWMClass=com.studiofour.draft.native\n`;
}
