import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({build:{rollupOptions:{input:resolve(import.meta.dirname,'host-ui/index.html')}}});
