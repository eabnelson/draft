import {test,expect} from '@playwright/test';

test('the production homepage completes writing, personal features, official update and reset at all screen sizes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/__checks__/walkthrough.html');
 await expect.poll(async()=>{const text=await page.locator('#result').innerText();return text.startsWith('{')?JSON.parse(text).status:'RUNNING';},{timeout:220000,intervals:[1000]}).not.toBe('RUNNING');
 const result=JSON.parse(await page.locator('#result').innerText());
 expect(result,JSON.stringify(result,null,2)).toHaveProperty('status','PASS');
 expect(errors).toEqual([]);
});

test('resizing keeps the full demo on screen without refreshing',async({page})=>{
 await page.goto('/__checks__/resize.html?full=1');
 await expect.poll(async()=>{const text=await page.locator('#result').innerText();return text.startsWith('{')?JSON.parse(text).status:'RUNNING';},{timeout:30000}).not.toBe('RUNNING');
 const result=JSON.parse(await page.locator('#result').innerText());expect(result,JSON.stringify(result)).toHaveProperty('status','PASS');
});
