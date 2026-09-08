import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only frame grabber.
 *
 * The prototype runs in a portrait frame that is usually inspected from a
 * backgrounded tab, where the compositor never presents a new frame — so an
 * external screenshot only ever shows the first paint. This lets the page hand
 * a rendered frame straight to disk:
 *
 *   await fetch('/__frame/mid-fall', { method: 'POST', body: canvasDataUrl })
 *
 * Frames land in `shots/`, which is also where pitch stills come from.
 */
function frameGrabber(): Plugin {
  return {
    name: 'frame-grabber',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__frame', (req, res) => {
        const name = decodeURIComponent(req.url?.replace(/^\//, '') || 'frame').replace(/[^\w.-]/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          mkdirSync('shots', { recursive: true });
          const file = join('shots', `${name}.jpg`);
          writeFileSync(file, Buffer.from(b64, 'base64'));
          res.setHeader('content-type', 'text/plain');
          res.end(file);
        });
      });
    },
  };
}

/** A build stamp the running page can print, so "old build or failed deploy?"
 *  stops being a guess. */
const BUILD = new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z';

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: {
    port: 5176,
    open: false,
    // Captured frames land inside the project; without this every grab looks
    // like a source change and Vite full-reloads the page mid-run.
    watch: { ignored: ['**/shots/**'] },
  },
  plugins: [frameGrabber()],
  // Rapier ships as WASM; it must not be pre-bundled or the init() shim breaks.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'] } },
    },
  },
});
