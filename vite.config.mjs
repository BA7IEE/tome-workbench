import fs from 'node:fs';
import { defineConfig } from 'vite';
export default defineConfig({define:{__APP_VERSION__:JSON.stringify(JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url),'utf8')).version)},root:'web',build:{outDir:'../dist/web',emptyOutDir:true,rollupOptions:{output:{manualChunks(id){if(id.includes('/node_modules/'))return 'ui-vendor';}}}},server:{host:'127.0.0.1',port:4319,proxy:{'/api':'http://127.0.0.1:4318'}}});
