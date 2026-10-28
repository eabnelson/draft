import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {nextPreviewVersion,versionContents} from './release-version';

type GitHub=(path:string,body?:unknown)=>Promise<any>;
export async function prepareMainRelease(root:string,source:string,api:GitHub){
 if(!/^[a-f0-9]{40}$/.test(source))throw Error('Expected the checked main commit.');
 // Only release the tested main head. A superseding push will get its own check.
 if((await api('/git/ref/heads/main')).object.sha!==source)return {skipped:true as const};
 const tags:Array<{name:string;commit:{sha:string}}>=[];
 for(let page=1;;page++){
  const batch=await api(`/tags?per_page=100&page=${page}`);tags.push(...batch);
  if(batch.length<100)break;
 }
 const base=(await Bun.file(resolve(root,'package.json')).json()).version;
 const previews=tags.filter(tag=>/^v\d+\.\d+\.\d+-alpha\.\d+$/.test(tag.name)).sort((a,b)=>Bun.semver.order(b.name.slice(1),a.name.slice(1)));
 for(const tag of previews){
  const commit=await api(`/git/commits/${tag.commit.sha}`);
  if(commit.parents?.[0]?.sha===source&&commit.message?.trim()===`Release Draft ${tag.name}\n\nDraft main commit: ${source}`){
   const release=await api(`/releases/tags/${tag.name}`);
   return release&&!release.draft?{skipped:true as const}:{skipped:false as const,tag:tag.name,sha:tag.commit.sha};
  }
 }
 const version=nextPreviewVersion(base,tags.map(tag=>tag.name)),tag=`v${version}`,parent=await api(`/git/commits/${source}`);
 const files=await versionContents(root,version);
 const tree=await api('/git/trees',{base_tree:parent.tree.sha,tree:Object.entries(files).map(([path,content])=>({path,mode:'100644',type:'blob',content}))});
 const commit=await api('/git/commits',{message:`Release Draft ${tag}\n\nDraft main commit: ${source}`,tree:tree.sha,parents:[source]});
 // GITHUB_TOKEN-created tags do not start a second workflow. The current run
 // builds this exact commit in its remaining jobs, without a bot push to main.
 await api('/git/refs',{ref:`refs/tags/${tag}`,sha:commit.sha});
 return {skipped:false as const,tag,sha:commit.sha};
}
if(import.meta.main){
 const {GITHUB_TOKEN,GITHUB_REPOSITORY,GITHUB_OUTPUT,DRAFT_MAIN_SHA}=process.env;
 if(!GITHUB_TOKEN||GITHUB_REPOSITORY!=='eabnelson/draft'||!GITHUB_OUTPUT)throw Error('Run main release preparation in the Draft release workflow.');
 const api:GitHub=async(path,body)=>{
  const response=await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status===404&&path.startsWith('/releases/tags/'))return null;
  if(!response.ok)throw Error(`GitHub release preparation failed (${response.status}, ${path}).`);
  return response.json();
 };
 const result=await prepareMainRelease(resolve(import.meta.dir,'..'),DRAFT_MAIN_SHA??'',api);
 await appendFile(GITHUB_OUTPUT,result.skipped?'skipped=true\n':`skipped=false\ntag=${result.tag}\nsha=${result.sha}\n`);
 console.log(result.skipped?'No unpublished checked main version needs a release.':`Prepared ${result.tag} from checked main ${DRAFT_MAIN_SHA}.`);
}
