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
    // When PORT is injected (e.g. by the preview tool) honor it.
    // The config never opens a browser: only 起動.bat does, by passing --open (the user's double-click). Tests, sub-agents
    // and the preview tool start this server over and over, and an auto-open here once put ~20 tabs into the user's own
    // Chrome (2026-10-07: `vite preview` inherits server.open, so scripts/ui_check.py opened one on every prod run).
    // strictPort: when the port is taken, fail instead of silently moving to the next one. Another port is another
    // origin, so the saved plans (localStorage) would look empty (see 起動.bat for the message the user gets).
    server: { port, strictPort: true, open: false },
    // Explicit, so that `vite preview` does not depend on inheriting server.open.
    preview: { open: false },
  };
});
