export const downloadFallback='https://github.com/eabnelson/draft/releases/download/v0.2.0-alpha.18/Draft-0.2.0-alpha.18-macos-arm64.dmg';
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
export async function latestMacDownload(){
 try{
  const response=await fetch('https://api.github.com/repos/eabnelson/draft/releases?per_page=20',{headers:{Accept:'application/vnd.github+json',...(process.env.GH_TOKEN?{Authorization:`Bearer ${process.env.GH_TOKEN}`}:{})},signal:AbortSignal.timeout(12000)});
  if(!response.ok)return downloadFallback;return resolveMacDownload(await response.json());
 }catch{return downloadFallback;}
}
