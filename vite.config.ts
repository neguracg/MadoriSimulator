import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  // When PORT is injected (e.g. by the preview tool) honor it and don't auto-open.
  server: { port, open: !process.env.PORT },
});
