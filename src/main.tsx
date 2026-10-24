import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './studio-theme.css';
import './style.css';
import {api} from './client';
try {
  const [library,health]=await Promise.all([api('/api/library'),api('/api/health')]);
  window.draftBoot={library,version:health.version};
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
} catch(error) {
  const root=document.getElementById('root')!;
  const title=document.createElement('h1');title.textContent='Draft could not open your documents.';
  const detail=document.createElement('p');detail.textContent=error instanceof Error?error.message:'Your local files are still on this Mac.';
  const button=document.createElement('button');button.textContent='Try again';button.onclick=()=>location.reload();root.append(title,detail,button);
}
