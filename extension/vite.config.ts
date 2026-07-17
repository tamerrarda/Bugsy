import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  // The `key` field pins a stable extension ID for local unpacked development,
  // which is what keeps the OAuth redirect URL constant while iterating. The
  // Chrome Web Store REJECTS an uploaded package that carries `key` ("key field
  // not allowed") — the store assigns the published ID itself. So the field is
  // kept for dev and stripped from the production package.
  const { key: _key, ...manifestNoKey } = manifest as typeof manifest & { key?: string }

  return {
    plugins: [
      react(),
      crx({
        manifest: {
          ...(isDev ? manifest : manifestNoKey),
          // The localhost grant exists only so `npm run dev` can talk to the
          // local Supabase stack. It must never ship: a store build carrying a
          // plaintext-HTTP host permission is both a Web Store review flag and a
          // standing CORS-bypass grant to whatever runs on 54321 on the user's
          // machine. Production builds keep only the Supabase origin.
          host_permissions: isDev
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
  }
})
