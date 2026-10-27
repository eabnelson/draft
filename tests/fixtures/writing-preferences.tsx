// Real writing UI with generic test text. Only spelling uses the local Mac service.
import {createRoot} from 'react-dom/client';
import App from '../../src/App';
import {configureDemo} from '../../src/client';
import {fresh,addVariant,addCandidate} from '../../src/model';
import official from '../../features.json';
import '../../src/studio-theme.css';
import '../../src/style.css';
import '../../src/writing.css';

let draft={...fresh(),title:'Writing preferences',text:'# A quieter page\n\nI can recieve a seperate mesage.\n\nGood writing leaves room to think.',revisionMode:true,overflow:'Keep a seperate note here.'};
const from=draft.text.indexOf('Good writing'),variant=addVariant(draft,{from,to:from+12});
draft=addCandidate(variant.draft,variant.variantId,'A thoughtful sentence','human');
draft=addCandidate(draft,variant.variantId,'A calm draft','ai','codex');
let library={active:draft.id,drafts:[draft],archived:[]},selection={provider:'claude',model:'test-claude'};
configureDemo(async(path,input)=>{
  if(path.startsWith('/api/spelling')){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return response.json();
  }
  if(path==='/api/library'){if(input)library=structuredClone(input) as typeof library;return structuredClone(library);}
  if(path.startsWith('/api/providers?'))return {selection,providers:['claude','codex'].map(provider=>({id:provider,name:provider==='claude'?'Claude Code':'Codex',installed:true,ready:true,models:[{provider,id:`test-${provider}`,name:provider==='claude'?'Claude':'Codex'}]}))};
  if(path==='/api/providers/select'){selection=input as typeof selection;return {};}
  if(path==='/api/assist')return {provider:selection.provider,response:JSON.stringify({alternatives:selection.provider==='claude'?['A clear thought','A little more space']:['Room for an idea']})};
  if(path==='/api/features')return {official,current:official,activeVersion:'writing-preferences-check',updates:[],featureQueue:[],handoffs:[],appVersion:official.appVersion,demo:true};
  if(path==='/api/updates/confirm'||path==='/api/close/ready')return {};
  throw Error('This local check does not use that action.');
},()=>{});
window.draftBoot={library,version:'writing-preferences-check'};
createRoot(document.getElementById('root')!).render(<App/>);
