/**
 * Credentials for the local Supabase stack, for scripts that talk to it directly.
 *
 * These used to be pasted inline. They are only the well-known demo keys the
 * Supabase CLI ships with — worthless outside a local Docker container — but a
 * service-role JWT committed to a public repo is still a service-role JWT
 * committed to a public repo: secret scanners flag it, and the next person to
 * copy the pattern may not be pointing at localhost. Read them from .env like
 * everything else, so there is exactly one rule and no exceptions to remember.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  // No .env — fall back to whatever is already exported (CI).
}

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(
      `\nMissing ${name}.\n` +
        'Copy .env.example to .env and fill it from `npx supabase status`.\n',
    )
    process.exit(1)
  }
  return value
}

export const API = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
export const ANON = required('SUPABASE_ANON_KEY')
export const SERVICE = required('SUPABASE_SERVICE_ROLE_KEY')
