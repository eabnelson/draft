import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {latestMacDownload} from './download';
import {checkDemoParity} from '../scripts/demo-parity';
const root=import.meta.dir;
await checkDemoParity(join(root,'..'));
await rm(join(root,'dist'),{recursive:true,force:true});await mkdir(join(root,'dist'),{recursive:true});
const download=await latestMacDownload();
const html=new HTMLRewriter().on('a[data-mac-download]',{element(element){element.setAttribute('href',download);}}).transform(new Response(await readFile(join(root,'index.html'),'utf8')));
await writeFile(join(root,'dist/index.html'),await html.text());await cp(join(root,'assets'),join(root,'dist/assets'),{recursive:true});
await cp(join(root,'share'),join(root,'dist/share'),{recursive:true});
const player=await Bun.build({entrypoints:[join(root,'player.ts')],outdir:join(root,'dist'),target:'browser',minify:true});if(!player.success)throw Error('The walkthrough player could not be built.');
const child=Bun.spawn([process.execPath,join(root,'../node_modules/vite/bin/vite.js'),'build','--config',join(root,'vite.config.ts')],{cwd:join(root,'..'),stdout:'inherit',stderr:'inherit'});if(await child.exited)process.exit(1);
const notices=[];for(const name of ['react','react-dom','scheduler','lucide-react','@codemirror/state','@codemirror/view','@codemirror/commands','@codemirror/language','@lezer/common','@lezer/highlight','@lezer/lr','style-mod','w3c-keyname','crelt','@marijn/find-cluster-break','class-variance-authority','clsx','tailwind-merge']){for(const file of ['LICENSE','LICENSE.txt','LICENSE.md'])try{notices.push(`${name}\n${await readFile(join(root,'../node_modules',name,file),'utf8')}`);break;}catch{}}
notices.push(`Provider logo assets\n${await readFile(join(root,'../src/assets/NOTICE.md'),'utf8')}\n${await readFile(join(root,'../src/assets/T3CODE-LICENSE'),'utf8')}`);
await writeFile(join(root,'dist/THIRD-PARTY-NOTICES.txt'),notices.join('\n\n---\n\n'));console.log('Draft website built in website/dist.');
