// Also works with older personal renderers during the one-time updater upgrade.
const bridgeAPI=async(path:string,body?:object)=>{
 const response=await fetch(path,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('Draft could not complete this request.');return response.json();
};
let opening=false;
async function openUpdates(){
 if(opening)return;opening=true;
 try{
  if(location.pathname==='/updates'){window.dispatchEvent(new Event('draft:check-updates'));return;}
  await bridgeAPI('/api/close/reset',{});window.dispatchEvent(new Event('draft:save-and-close'));
  for(let i=0;i<100;i++){if((await bridgeAPI('/api/health')).closeReady){location.assign('/updates?check=1');return;}await new Promise(resolve=>setTimeout(resolve,100));}
  notice('Save your writing before opening updates.');
 }catch{notice('Draft couldn’t open updates. Try again in a moment.');}finally{opening=false;}
}
let banner:HTMLButtonElement|undefined;
function notice(text:string){if(!banner){banner=document.createElement('button');banner.type='button';banner.setAttribute('aria-label','Open Draft updates');Object.assign(banner.style,{position:'fixed',right:'18px',bottom:'54px',zIndex:'1000',padding:'9px 14px',border:'1px solid var(--border,#ddd)',borderRadius:'10px',background:'var(--background,#fff)',color:'var(--foreground,#222)',font:'13px system-ui',boxShadow:'0 4px 18px #0001',cursor:'pointer'});banner.onclick=()=>void openUpdates();document.body.append(banner);}banner.textContent=text;}
window.addEventListener('draft:open-updates',()=>void openUpdates());
window.addEventListener('draft:update-failed',()=>location.reload());
window.addEventListener('focus',()=>void bridgeAPI('/api/updates/check',{background:true}).catch(()=>{}));
setInterval(()=>{
 if(location.pathname==='/updates'||(window as any).__draftUpdateUI)return;
 void bridgeAPI('/api/features').then(value=>{if(value.latestOfficial||value.updates?.some((update:any)=>['ready','needs-attention'].includes(update.state)))notice('A Draft update is available');else{banner?.remove();banner=undefined;}}).catch(()=>{});
},5000);
