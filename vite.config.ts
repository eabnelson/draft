import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'./',build:{target:'esnext',rollupOptions:{output:{manualChunks:{editor:['@codemirror/state','@codemirror/view','@codemirror/commands']}}}}});
