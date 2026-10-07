import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { APP_BASE_PATH } from './src/constants';

// GitHub Pages serves a project site under /<repo>/, so the production build
// needs that base path (APP_BASE_PATH: the same address the share link of a local run points at). Local dev keeps '/'.
export default defineConfig(({ command }) => {
  const port = Number(process.env.PORT) || 5173;
  return {
    plugins: [react()],
    base: command === 'build' ? APP_BASE_PATH : '/',
    // When PORT is injected (e.g. by the preview tool) honor it and don't auto-open.
    // strictPort: when the port is taken, fail instead of silently moving to the next one. Another port is another
    // origin, so the saved plans (localStorage) would look empty (see 起動.bat for the message the user gets).
    server: { port, strictPort: true, open: !process.env.PORT },
  };
});
