import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mockApi } from './src/mock-api.js';
export default defineConfig({ plugins: [mockApi()], server: { port: 4311, strictPort: true, fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../docs/research/vuon-van-ca-nhan.pages.dev/source/', import.meta.url))] } } });
