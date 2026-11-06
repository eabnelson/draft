import {isAbsolute} from 'node:path';
import {DraftStore} from '../../desktop/documents';
import {plainText} from '../../src/markdown';
import {addVersion,chooseStage,deleteVersion,editVersion,inboxOrder,openVersions,rename,renameVersion,setPinned,setVersionHidden,STAGES,versionById,type Draft,type Stage} from '../../src/model';

export type DraftAction={kind:string;version?:string;value?:string;destination?:string};

export async function saveSnapshot(store:DraftStore,draft:Draft):Promise<Draft>{
  const previous=await store.read(store.package(draft.id));
  let next={...draft,updatedAt:previous.updatedAt,versions:draft.versions.map(v=>{
    const before=previous.versions.find(p=>p.id===v.id);
    return {...v,text:before?.text??v.text,updatedAt:before?.updatedAt??v.updatedAt};
  })};
  for(const v of draft.versions)next=editVersion(next,v.id,v.text);
  await store.save(next);
  return store.read(store.package(next.id));
}

export async function draftAction(store:DraftStore,input:Draft,action:DraftAction){
  let draft=await saveSnapshot(store,input),focus:string|null=null,message='Draft updated';
  if(action.version&&!versionById(draft,action.version))throw Error('That version no longer exists.');
  switch(action.kind){
    case 'rename':
      if(typeof action.value!=='string'||action.value.length>500)throw Error('Choose a shorter name.');
      draft=action.version?renameVersion(draft,action.version,action.value):rename(draft,action.value.trim());
      message='Name saved';break;
    case 'pin':draft=setPinned(draft,!draft.pinned);message=draft.pinned?'Draft pinned':'Draft unpinned';break;
    case 'stage':
      if(!action.value||!Object.hasOwn(STAGES,action.value))throw Error('Choose a valid status.');
      draft=chooseStage(draft,action.value as Stage);message='Status updated';break;
    case 'new-version':{
      const added=addVersion(draft,action.version??'latest');draft=added.draft;focus=added.version.id;message='New version created';break;
    }
    case 'open-version':
      if(!action.version)throw Error('Choose a version.');
      draft=setVersionHidden(draft,action.version,false);focus=action.version;break;
    case 'close-version':
      if(!action.version||openVersions(draft).length<2)throw Error('The last open tab stays open.');
      draft=setVersionHidden(draft,action.version,true);message='Tab closed';break;
    case 'delete-version':
      if(!action.version)throw Error('Choose a version.');
      draft=deleteVersion(draft,action.version);message='Version moved to Recovery';break;
    case 'archive':await store.archive(draft.id);message='Draft archived';break;
    case 'delete':await store.delete(draft.id);message='Draft moved to Recovery';break;
    case 'export':{
      if(!action.destination||!isAbsolute(action.destination))throw Error('Choose an export folder.');
      const path=await store.export(draft.id,action.destination,plainText);message=`Exported to ${path}`;break;
    }
    default:throw Error('Unknown draft action.');
  }
  if(!['archive','delete','export'].includes(action.kind))await store.save(draft);
  const library=await store.load();library.drafts=inboxOrder(library.drafts);
  return {library,focus,message};
}
