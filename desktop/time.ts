// Shared wording for when something happened, as Settings shows it.
/// How Settings names a moment: "just now", "5 minutes ago", "today at 3:12 PM", "Nov 7 at 5:21 PM".
export function moment(iso:string,now=new Date()){
  const date=new Date(iso),minutes=Math.floor((now.getTime()-date.getTime())/60000);
  if(Number.isNaN(minutes))return '';
  if(minutes<1)return 'just now';
  if(minutes<60)return `${minutes} ${minutes===1?'minute':'minutes'} ago`;
  const time=date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  if(date.toDateString()===now.toDateString())return `today at ${time}`;
  return `${date.toLocaleDateString('en-US',{month:'short',day:'numeric',...(date.getFullYear()===now.getFullYear()?{}:{year:'numeric'})})} at ${time}`;
}
