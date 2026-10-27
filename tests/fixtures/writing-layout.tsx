import {createRoot} from 'react-dom/client';
import App from '../../src/App';
import {configureDemo} from '../../src/client';
import {fresh,addVariant,addCandidate} from '../../src/model';
import official from '../../features.json';
import '../../src/studio-theme.css';
import '../../src/style.css';
import '../../src/writing.css';
const before=Array.from({length:16},(_,i)=>`Thought ${i+1}. A quiet page gives an idea enough room to grow.`).join('\n\n');
const sentence='A sentence can hold many possibilities while keeping its own familiar voice.';
let draft={...fresh(),title:'Centered writing',text:before+'\n\n'+sentence+'\n\nA final thought waits here.',revisionMode:true};
const from=draft.text.indexOf(sentence),variant=addVariant(draft,{from,to:from+sentence.length},'sentence');draft=variant.draft;
for(let i=0;i<35;i++)draft=addCandidate(draft,variant.variantId,i===0?'One thought.':`Alternative ${i+1} keeps the writing clear.`);
let library={active:draft.id,drafts:[draft],archived:[]};
configureDemo(async(path,input)=>{
 if(path==='/api/library'){if(input)library=structuredClone(input) as typeof library;return structuredClone(library);}
 if(path==='/api/spelling')return {available:false,words:[]};
 if(path==='/api/features')return {official,current:official,activeVersion:'writing-layout-check',updates:[],featureQueue:[],handoffs:[],appVersion:official.appVersion,demo:true};
 if(path==='/api/updates/confirm'||path==='/api/close/ready')return {};
 throw Error('This local check does not use that action.');
},()=>{});
window.draftBoot={library,version:'writing-layout-check'};createRoot(document.getElementById('root')!).render(<App/>);
