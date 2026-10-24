import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({root:resolve(import.meta.dirname,'demo'),publicDir:resolve(import.meta.dirname,'../public'),base:'./',plugins:[react()],build:{outDir:resolve(import.meta.dirname,'dist/demo'),emptyOutDir:true,target:'esnext',rollupOptions:{output:{manualChunks:{editor:['@codemirror/state','@codemirror/view','@codemirror/commands']}}}}});
