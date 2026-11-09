export const downloadFallback='https://github.com/eabnelson/draft/releases/download/v0.3.0-alpha.71/Draft-0.3.0-alpha.71-macos-arm64.dmg';
export function resolveMacDownload(releases:unknown){
 if(!Array.isArray(releases))return downloadFallback;
 const candidates=releases.flatMap(release=>{
  const version=typeof release.tag_name==='string'?release.tag_name.replace(/^v/,''):'';
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))return [];
  try{Bun.semver.order(version,version);}catch{return [];}
  if(release.draft||!Array.isArray(release.assets))return [];
  const name=`Draft-${version}-macos-arm64.dmg`,url=release.assets.find((asset:any)=>asset.name===name)?.browser_download_url;
  if(url!==`https://github.com/eabnelson/draft/releases/download/v${version}/${name}`)return [];
  return [{version,url}];
 }).sort((a,b)=>Bun.semver.order(b.version,a.version));
 return candidates[0]?.url??downloadFallback;
}
export const linuxFallback='https://github.com/eabnelson/draft/releases';
/// The newest published release page that offers both Linux builds; people pick their architecture there.
export function resolveLinuxRelease(releases:unknown){
 if(!Array.isArray(releases))return linuxFallback;
 const candidates=releases.flatMap(release=>{
  const version=typeof release.tag_name==='string'?release.tag_name.replace(/^v/,''):'';
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))return [];
  try{Bun.semver.order(version,version);}catch{return [];}
  if(release.draft||!Array.isArray(release.assets))return [];
  const page=`https://github.com/eabnelson/draft/releases/tag/v${version}`;
  const complete=['x64','arm64'].every(arch=>{const name=`Draft-${version}-linux-${arch}.tar.gz`;return release.assets.some((asset:any)=>asset.name===name&&asset.browser_download_url===`https://github.com/eabnelson/draft/releases/download/v${version}/${name}`);});
  return complete&&release.html_url===page?[{version,url:page}]:[];
 }).sort((a,b)=>Bun.semver.order(b.version,a.version));
 return candidates[0]?.url??linuxFallback;
}
async function releases(){
 const response=await fetch('https://api.github.com/repos/eabnelson/draft/releases?per_page=20',{headers:{Accept:'application/vnd.github+json',...(process.env.GH_TOKEN?{Authorization:`Bearer ${process.env.GH_TOKEN}`}:{})},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('The release list is unavailable.');return response.json();
}
export async function latestDownloads(){
 try{const list=await releases();return {mac:resolveMacDownload(list),linux:resolveLinuxRelease(list)};}
 catch{return {mac:downloadFallback,linux:linuxFallback};}
}
