import { defineConfig } from 'vite';
import { mockApi } from './src/mock-api.js';
export default defineConfig({ plugins: [mockApi()], server: { port: 4311, strictPort: true } });
