import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {latestMacDownload} from './download';
const root=import.meta.dir;
// The website is a plain download page until Draft 2.0 ships and the walkthrough is redesigned.
await rm(join(root,'dist'),{recursive:true,force:true});await mkdir(join(root,'dist'),{recursive:true});
const download=await latestMacDownload();
const html=new HTMLRewriter().on('a[data-mac-download]',{element(element){element.setAttribute('href',download);}}).transform(new Response(await readFile(join(root,'index.html'),'utf8')));
await writeFile(join(root,'dist/index.html'),await html.text());await cp(join(root,'assets'),join(root,'dist/assets'),{recursive:true});
console.log('Draft website built in website/dist.');
