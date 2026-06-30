import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site under /<repo>/, so the production build
// needs that base path. Local dev keeps '/'.
export default defineConfig(({ command }) => {
  const port = Number(process.env.PORT) || 5173;
  return {
    plugins: [react()],
    base: command === 'build' ? '/MadoriSimulator/' : '/',
    // When PORT is injected (e.g. by the preview tool) honor it and don't auto-open.
    server: { port, open: !process.env.PORT },
  };
});
