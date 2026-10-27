// Local browser fixture: real writing UI, deterministic suggestions, no AI calls.
import {createRoot} from 'react-dom/client';
import App from '../../src/App';
import {configureDemo} from '../../src/client';
import {fresh} from '../../src/model';
import official from '../../features.json';
import '../../src/studio-theme.css';
import '../../src/style.css';
import '../../src/writing.css';

const flags=[
  {text:'We write together and we learn as we go.',reason:'Separate the two complete thoughts with a comma.',replacement:'We write together, and we learn as we go.'},
  {text:'Teh next idea is worth keeping.',reason:'Correct the spelling of “The”.',replacement:'The next idea is worth keeping.'},
  {text:'When the page is quiet we can hear the words.',reason:'Add a comma after the opening phrase.',replacement:'When the page is quiet, we can hear the words.'},
];
const paragraphs=[
  '# Room to think',
  ...flags.map(flag=>flag.text),
  ...Array.from({length:6},(_,index)=>`Thought ${index+1}. Good writing takes a little time. Keeping the page calm helps us see which words belong and which thoughts need more room to grow.`),
  'A final thought stays here.',
];
const draft={...fresh(),title:'Suggestions and scrolling',text:paragraphs.join('\n\n')+'\n\n\n',revisionMode:true,overflow:'A spare idea stays separate.'};
let library={active:draft.id,drafts:[draft],archived:[]};
configureDemo(async(path,input)=>{
  if(path==='/api/library'){if(input)library=structuredClone(input) as typeof library;return structuredClone(library);}
  if(path==='/api/features')return {official,current:official,activeVersion:'writing-check',updates:[],featureQueue:[],handoffs:[],appVersion:official.appVersion,demo:true};
  if(path==='/api/assist')return {response:JSON.stringify({flags})};
  if(path==='/api/spelling')return {available:false,words:[]};
  if(path==='/api/updates/confirm'||path==='/api/close/ready')return {};
  throw Error('This local check does not use that action.');
},()=>{});
window.draftBoot={library,version:'writing-check'};
createRoot(document.getElementById('root')!).render(<App/>);
