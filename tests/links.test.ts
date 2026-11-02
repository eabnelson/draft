import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,ChangeSet,Text} from '@codemirror/state';
import {markdownEditing,showMarkdown} from '../src/editor-markdown';
import {markdownLinks,unlinkMarkdown} from '../src/links';
import {formatMarkdown,safeLinkURL} from '../src/markdown';
import {openExternalLink} from '../desktop/links';

function edit(text:string,from:number,to:number,insert='',source=false){
  let state=EditorState.create({doc:text,extensions:markdownEditing});
  if(source)state=state.update({effects:showMarkdown.of(true)}).state;
  return state.update({changes:{from,to,insert},userEvent:insert?'input.type':'delete.selection'}).state.doc.toString();
}
test('deleting all visible link text removes its hidden destination in the actual editor transaction',()=>{
  assert.equal(edit('Read [this](https://example.com) today.',6,10),'Read  today.');
  assert.equal(edit('[x](https://example.com)',1,2),'');
});
test('partial label edits retain a working link while boundary-crossing deletion keeps unselected text',()=>{
  const text='See [linked text](https://example.com) now.';
  assert.equal(edit(text,5,11,'new'),'See [new text](https://example.com) now.');
  assert.equal(edit(text,2,8),'Seked text now.');
  assert.equal(edit(text,text.indexOf('text'),text.indexOf(' now.')),'See linked  now.');
});
test('replacing a whole link, pasting a new link, and editing outside a link are untouched',()=>{
  const text='A [link](https://example.com).';
  assert.equal(edit(text,2,text.length-1,'new'),'A new.');
  assert.equal(edit(text,2,text.length-1,'[other](https://new.example)'),'A [other](https://new.example).');
  assert.equal(edit(text,text.length,text.length,' More.'),text+' More.');
  assert.equal(edit(text,3,7,'replacement'),'A [replacement](https://example.com).');
});
test('deletion across two links never leaves hidden brackets or destinations',()=>{
  const text='[first](https://one.example) and [second](https://two.example)';
  const end=text.indexOf('second')+3;
  assert.equal(edit(text,3,end),'fiond');
});
test('source mode keeps literal Markdown editing available',()=>{
  assert.equal(edit('[x](https://example.com)',1,2,'',true),'[](https://example.com)');
});
test('unlinking preserves label formatting and the caret',()=>{
  const text='A [**clear** idea](https://example.com) stays.';
  const link=markdownLinks(text)[0],edit=unlinkMarkdown(text,link,link.to);
  assert.equal(ChangeSet.of(edit.changes,text.length).apply(Text.of([text])).toString(),'A **clear** idea stays.');
  assert.equal(edit.selection.from,'A **clear** idea'.length);
});
test('links parse formatted labels, titles, references, and autolinks',()=>{
  for(const text of ['[**bold**](https://example.com "Title")','[word][ref]\n\n[ref]: https://example.com','<https://example.com>']){
    const links=markdownLinks(text);assert.equal(links.length,1);assert.equal(links[0].url,'https://example.com/');
    const edit=unlinkMarkdown(text,links[0]);
    const plain=ChangeSet.of(edit.changes,text.length).apply(Text.of(text.split('\n'))).toString();
    assert.ok(!plain.startsWith('[')&&!plain.startsWith('<'));
  }
});
test('creating or updating a link leaves the caret after it for plain writing',()=>{
  const edit=formatMarkdown('a word',{from:2,to:6},'link','https://example.com');
  assert.equal(edit.selection.from,2+edit.insert.length);
  assert.equal(edit.selection.to,edit.selection.from);
});
test('external links accept only web and email addresses and pass one validated argument to the opener',async()=>{
  const opened:string[]=[];
  await openExternalLink('https://example.com/a?b=1&c=2',async value=>{opened.push(value);});
  assert.deepEqual(opened,['https://example.com/a?b=1&c=2']);
  for(const value of ['javascript:alert(1)','file:///tmp/test','data:text/html,test','https://example.com\n',{},null]){
    await assert.rejects(()=>openExternalLink(value,async()=>{throw Error('Should not open');}),/web address/);
  }
  assert.equal(safeLinkURL('mailto:hello@example.com'),'mailto:hello@example.com');
});
