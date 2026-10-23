import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';


// A strict Content-Security-Policy for production builds: the page may talk only
// to itself, the Supabase project, GitHub and the sign-in bridge, so decrypted audio and annotations
// cannot be sent anywhere else by injected or third-party code.
const csp = (bridge: string): Plugin => ({
  name: 'annotino-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com ${bridge}`.trim(),
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "worker-src 'self' blob:",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
    return html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    );
  },
});

export default defineConfig(({ mode }) => {
  // The GitHub sign-in bridge (bridge/worker.js), when this build uses the Annotino GitHub App.
  const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_GITHUB_BRIDGE;
  const bridge = url ? new URL(url).origin : '';
  return {
    plugins: [react(), csp(bridge)],
    base: './',
    worker: { format: 'es' },
    // supabase-js is most of the bundle (about 150 kB gzipped in total).
    build: { chunkSizeWarningLimit: 700 },
  };
});
