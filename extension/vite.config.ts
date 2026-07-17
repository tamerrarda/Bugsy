import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    crx({
      manifest: {
        ...manifest,
        // The localhost grant exists only so `npm run dev` can talk to the
        // local Supabase stack. It must never ship: a store build carrying a
        // plaintext-HTTP host permission is both a Web Store review flag and a
        // standing CORS-bypass grant to whatever runs on 54321 on the user's
        // machine. Production builds keep only the Supabase origin.
        host_permissions:
          mode === 'development'
            ? manifest.host_permissions
            : manifest.host_permissions.filter((origin) => !origin.startsWith('http://')),
      },
    }),
  ],
  build: {
    target: 'esnext',
    // Shiki's grammars are chunky; the popup lazy-loads the highlighter so this
    // only affects the async chunk, not first paint.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
}))
