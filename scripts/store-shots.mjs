/**
 * Chrome Web Store screenshots, taken from the REAL popup running against the
 * real local backend — not mockups. The Store wants 1280×800, so the 400×600
 * popup is composited onto a branded backdrop at that size.
 *
 * Requires: `npx supabase start`, then `npm run build` in extension/.
 *   node scripts/store-shots.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, ANON, SERVICE } from './local-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'extension', 'dist')
const OUT = join(ROOT, 'store', 'screenshots')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 8911
const CDP_PORT = 9339


mkdirSync(OUT, { recursive: true })

// A player with some history, so the leaderboard and profile are not empty.
const email = `store-${Date.now()}@example.com`
await fetch(`${API}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email, password: 'pw-123456', email_confirm: true,
    user_metadata: { user_name: 'you', avatar_url: '' },
  }),
}).then((r) => r.json())

const session = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'pw-123456' }),
}).then((r) => r.json())

const stored = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
  expires_in: session.expires_in,
  token_type: 'bearer',
  user: session.user,
})

// The shell page: backdrop + caption + the popup in an iframe at true size.
const SHELL = `
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;
    background:radial-gradient(1000px 600px at 78% 18%, #241a16 0%, #0e0e11 62%);
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#e8e8ea}
  .wrap{display:flex;align-items:center;justify-content:center;gap:88px;height:100%}
  .copy{max-width:420px}
  h1{margin:0;font-size:46px;line-height:1.1;letter-spacing:-0.02em;font-weight:800}
  p{margin:16px 0 0;font-size:20px;line-height:1.5;color:#8a8a94}
  .frame{width:400px;height:600px;border-radius:16px;overflow:hidden;
    border:1px solid #2a2a33;box-shadow:0 40px 90px rgba(0,0,0,.6)}
  iframe{width:400px;height:600px;border:0;display:block}
  .mark{position:absolute;top:40px;left:56px;display:flex;align-items:center;gap:10px;
    font-weight:800;font-size:19px;letter-spacing:-0.01em}
  .mark img{width:30px;height:30px}
</style>
<div class="mark"><img src="/mascot/bugsy-happy.png"><span>Bugsy</span></div>
<div class="wrap">
  <div class="copy"><h1 id="cap-title"></h1><p id="cap-sub"></p></div>
  <div class="frame"><iframe id="bugsy-frame" src="/index.html"></iframe></div>
</div>
`

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }

// The shell and the popup MUST be served from the same origin, or the iframe is
// cross-origin and its contentWindow.document is unreachable — which means the
// screenshots could not be driven at all.
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0]

  if (path === '/shell.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(SHELL)
    return
  }

  const file = join(DIST, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(PORT, r))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-first-run',
  '--disable-gpu', '--force-device-scale-factor=2', '--user-data-dir=/tmp/bugsy-store', 'about:blank',
], { stdio: 'ignore' })

let wsUrl
for (let i = 0; i < 60; i++) {
  try {
    const t = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())
    const p = t.find((x) => x.type === 'page')
    if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
  } catch {}
  await new Promise((r) => setTimeout(r, 250))
}

const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')

// Store screenshots are 1280×800. Frame the 400×600 popup inside a branded
// backdrop at that size rather than upscaling it into a blurry mess.
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    const store = { local: { 'bugsy:auth': ${JSON.stringify(stored)} }, sync: { 'bugsy:onboarded': true } };
    const area = (n) => ({
      get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const out = {}; for (const key of keys) if (key in store[n]) out[key] = store[n][key]; return out; },
      set: async (o) => { Object.assign(store[n], o); },
      remove: async (k) => { delete store[n][k]; },
    });
    window.chrome = {
      storage: { local: area('local'), sync: area('sync'), onChanged: { addListener() {} } },
      notifications: { create() {} },
      runtime: { getURL: (p) => p },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      identity: { getRedirectURL: () => 'https://x.chromiumapp.org/' },
    };
  `,
})

const CAPTION = {
  '1-daily': ['One bug per snippet.', 'Sixty seconds. Click the line.'],
  '2-result': ['Always an explanation.', 'Not just what — why.'],
  '3-summary': ['Share it, spoiler-free.', 'Wordle-style emoji grid.'],
  '4-leaderboard': ['Same three bugs.', 'Everyone, every day.'],
  '5-profile': ['Six badges.', 'And a streak worth keeping.'],
}

/** Frames the popup iframe on a branded 1280×800 backdrop and shoots it. */
async function shoot(name) {
  const [title, sub] = CAPTION[name]
  await evaluate(`
    (() => {
      const f = document.getElementById('bugsy-frame');
      const t = document.getElementById('cap-title');
      const s = document.getElementById('cap-sub');
      if (t) t.textContent = ${JSON.stringify(title)};
      if (s) s.textContent = ${JSON.stringify(sub)};
      return !!f;
    })()
  `)
  await sleep(400)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`→ store/screenshots/${name}.png`)
}



await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/shell.html` })
await sleep(2500)

// Drive the popup INSIDE the iframe.
const inFrame = async (expr) =>
  evaluate(`(async () => {
    const w = document.getElementById('bugsy-frame').contentWindow;
    const d = w.document;
    return await (async (document, window) => { ${expr} })(d, w);
  })()`)

// Play it properly. Clicking blindly gave a 0/3 grid — a real playthrough, but a
// miserable advert. Read today's real bug lines and play a competent 2/3, which
// is also the grid the spec uses as its example.
const today = new Date().toISOString().slice(0, 10)
const [{ challenge_ids: dailyIds }] = await fetch(
  `${API}/rest/v1/daily_sets?day=eq.${today}&select=challenge_ids`,
  { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
).then((r) => r.json())

const bugLines = Object.fromEntries(
  (
    await fetch(
      `${API}/rest/v1/challenges?id=in.(${dailyIds.join(',')})&select=id,bug_line`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    ).then((r) => r.json())
  ).map((c) => [c.id, c.bug_line]),
)

await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.includes("Play today")).click()`)
await sleep(2800)
await shoot('1-daily')

/** Clicks the given 1-indexed line in the popup. */
const clickLine = (n) => inFrame(`document.querySelectorAll('.code-line')[${n - 1}].click()`)

/** The id of the snippet currently on screen, so we know which answer is right. */
const currentId = () =>
  inFrame(`
    const el = document.querySelector('.chip--progress');
    return window.__bugsyCurrent ?? null;
  `)

// Snippet 1: get it wrong, on purpose — the result screenshot needs a miss to
// show BOTH the red line and the green one.
const first = dailyIds[0]
const firstBug = bugLines[first]
await clickLine(firstBug === 1 ? 2 : 1)
await sleep(1600)

// The caption promises an explanation, so the explanation had better be in the
// frame. The reveal scrolls the bug line into view, which pushes the result card
// below the fold — scroll back down to it.
await inFrame(`
  document.querySelector('.result')?.scrollIntoView({ block: 'end' });
  return true;
`)
await sleep(700)
await shoot('2-result')

// Snippets 2 and 3: get them right. Final grid 🟥🟩🟩 — 2/3.
for (const id of dailyIds.slice(1)) {
  await inFrame(`document.querySelector('.result .btn--primary').click()`)
  await sleep(1800)
  await clickLine(bugLines[id])
  await sleep(1800)
}
await inFrame(`document.querySelector('.result .btn--primary').click()`)
await sleep(1800)
await shoot('3-summary')

await inFrame(`document.querySelector('.summary .btn--ghost').click()`)
await sleep(800)
await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Leaderboard').click()`)
await sleep(2200)
await shoot('4-leaderboard')

await inFrame(`document.querySelector('.topbar__back').click()`)
await sleep(700)
await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Profile').click()`)
await sleep(2200)
await shoot('5-profile')

ws.close(); chrome.kill(); server.close(); process.exit(0)
