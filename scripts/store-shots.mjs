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

/** The daily language shown in the screenshots. */
const TRACK = 'python'


mkdirSync(OUT, { recursive: true })

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

// Wipe the local users first. Every e2e run leaves its cast behind, and the last
// leaderboard screenshot was topped by `you-3`, `veteran-2` and `badge-hard-1` —
// the test suite's own accounts, advertised to the Chrome Web Store. It also
// means our player is `you` and not `you-5`: the username is unique, so the old
// rows were pushing ours down the alphabet with every run.
const existing = await fetch(`${API}/auth/v1/admin/users?per_page=1000`, { headers: svc })
  .then((r) => r.json())
for (const u of existing.users ?? []) {
  await fetch(`${API}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: svc })
}

/** Creates a player and returns { id, session }. */
async function signUp(username) {
  const email = `store-${username}-${Date.now()}@example.com`
  await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({
      email, password: 'pw-123456', email_confirm: true,
      user_metadata: { user_name: username, avatar_url: '' },
    }),
  }).then((r) => r.json())

  const session = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456' }),
  }).then((r) => r.json())

  return { id: session.user.id, session }
}

const me = await signUp('you')
const session = me.session

const stored = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
  expires_in: session.expires_in,
  token_type: 'bearer',
  user: session.user,
})

const pool = await fetch(
  `${API}/rest/v1/challenges?select=id,bug_line,language&active=eq.true`,
  { headers: svc },
).then((r) => r.json())

/**
 * Plays one snippet as `userId`, `seconds` after it was served.
 *
 * Nothing here is faked: every attempt goes through the real submit_attempt
 * transaction and earns exactly what a human would earn for the same answer at
 * the same speed. Back-dating the serve is the only way to stage a fast read —
 * a script cannot type quickly.
 */
async function play(userId, challenge, { mode = 'practice', correct = true, seconds = 9 } = {}) {
  await fetch(`${API}/rest/v1/serves`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: userId,
      challenge_id: challenge.id,
      mode,
      served_at: new Date(Date.now() - seconds * 1000).toISOString(),
    }),
  })
  await fetch(`${API}/rest/v1/rpc/submit_attempt`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({
      p_user_id: userId,
      p_challenge_id: challenge.id,
      p_mode: mode,
      p_clicked_line: correct ? challenge.bug_line : challenge.bug_line === 1 ? 2 : 1,
    }),
  })
}

// Today's daily set. It is built lazily on the first serve, and there is one per
// (day, language) since language tracks landed — so build ours before asking.
const today = new Date().toISOString().slice(0, 10)
await fetch(`${API}/rest/v1/rpc/ensure_daily_set`, {
  method: 'POST', headers: svc, body: JSON.stringify({ p_day: today, p_language: TRACK }),
})
const [{ challenge_ids: dailyIds }] = await fetch(
  `${API}/rest/v1/daily_sets?day=eq.${today}&language=eq.${TRACK}&select=challenge_ids`,
  { headers: svc },
).then((r) => r.json())
const daily = dailyIds.map((id) => pool.find((c) => c.id === id))

// The leaderboard needs a field to lead. These are demo accounts on a local
// database, and they play today's real daily set at different speeds, so the
// ranking below is what the scoring function actually produced.
// `practice` matters as much as `right`: the leaderboard counts every point
// earned today, and our player is about to grind twelve practice snippets for
// their badges. Rivals who only played the daily left them 4× clear of second
// place — a board nobody is competing on, which is the opposite of the point.
const RIVALS = [
  { name: 'mira', right: 3, seconds: 11, practice: 14 },
  { name: 'kenji', right: 3, seconds: 18, practice: 12 },
  { name: 'sofia', right: 2, seconds: 14, practice: 11 },
  { name: 'devrim', right: 2, seconds: 26, practice: 8 },
  { name: 'lena', right: 1, seconds: 21, practice: 6 },
  { name: 'omar', right: 1, seconds: 35, practice: 4 },
]
for (const [r, rival] of RIVALS.entries()) {
  const { id } = await signUp(rival.name)
  for (const [i, c] of daily.entries()) {
    await play(id, c, { mode: 'daily', correct: i < rival.right, seconds: rival.seconds })
  }
  // A different slice each, so they are not all solving the same snippets.
  for (const c of pool.slice(40 + r * 25, 40 + r * 25 + rival.practice)) {
    await play(id, c, { seconds: rival.seconds })
  }
}

// A brand-new account screenshots an empty profile — "No badges yet" — which is
// honest and a terrible advert. So give our player a past: one bug in each of
// the eight languages (that is the Polyglot badge), a couple read fast enough to
// earn the speed badges, and a few more for volume.
const LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'csharp', 'c', 'cpp', 'rust']
const history = LANGUAGES.map((lang) => pool.find((c) => c.language === lang)).filter(Boolean)
for (const [i, c] of history.entries()) await play(me.id, c, { seconds: i === 0 ? 4 : 9 })
for (const c of pool.filter((c) => !history.includes(c) && !daily.includes(c)).slice(0, 4)) {
  await play(me.id, c, { seconds: 12 })
}

// The shell page: backdrop + caption + the popup in an iframe at true size.
// The backdrop wears the same clothes as the product: Bugsy's garden, the warm
// palette from popup.css, Baloo for the headline. A dark, techy slide holding a
// storybook popup reads as two different products in one image.
const SHELL = `
<!doctype html><meta charset="utf-8">
<style>
  @font-face{font-family:'Baloo';src:url('/fonts/baloo2.woff2') format('woff2');font-weight:700 800;font-display:block}
  @font-face{font-family:'Nunito';src:url('/fonts/nunito.woff2') format('woff2');font-weight:400 700;font-display:block}
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;
    font-family:'Nunito',system-ui,sans-serif;color:#5a3d24}
  body::before{content:'';position:fixed;inset:0;
    background:url('/bg/garden.webp') center/cover no-repeat;
    filter:saturate(1.05)}
  body::after{content:'';position:fixed;inset:0;
    background:radial-gradient(900px 620px at 26% 50%, rgba(253,247,232,.94) 0%, rgba(251,241,220,.72) 45%, rgba(251,241,220,0) 78%)}
  .wrap{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:88px;height:100%}
  .copy{max-width:430px}
  h1{margin:0;font-family:'Baloo',cursive;font-size:52px;line-height:1.08;font-weight:800;color:#5a3d24}
  p{margin:18px 0 0;font-size:21px;line-height:1.5;color:#9b7d5e;font-weight:600}
  .frame{width:400px;height:600px;border-radius:22px;overflow:hidden;
    border:3px solid #e3cfa8;box-shadow:0 34px 70px rgba(90,61,36,.28)}
  iframe{width:400px;height:600px;border:0;display:block}
  .mark{position:absolute;z-index:2;top:38px;left:54px;display:flex;align-items:center;gap:11px;
    font-family:'Baloo',cursive;font-weight:800;font-size:24px;color:#5a3d24}
  .mark img{width:36px;height:36px}
</style>
<div class="mark"><img src="/mascot/bugsy-happy.png"><span>Bugsy</span></div>
<div class="wrap">
  <div class="copy"><h1 id="cap-title"></h1><p id="cap-sub"></p></div>
  <div class="frame"><iframe id="bugsy-frame" src="/index.html"></iframe></div>
</div>
`

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' }

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
    const store = {
      local: { 'bugsy:auth': ${JSON.stringify(stored)} },
      // Pre-pick the track. Otherwise "Play today's challenge" opens the language
      // picker, and the first screenshot is a menu instead of the game.
      sync: { 'bugsy:onboarded': true, 'bugsy:dailyTrack': ${JSON.stringify(TRACK)} },
    };
    const area = (n) => ({
      get: async (k) => { if (k === null) return { ...store[n] }; const keys = Array.isArray(k) ? k : [k]; const out = {}; for (const key of keys) if (key in store[n]) out[key] = store[n][key]; return out; },
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
  '5-profile': ['Thirty-one badges.', 'And a streak worth keeping.'],
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

await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.includes("Play today")).click()`)
await sleep(2800)
await shoot('1-daily')

/** Clicks the given 1-indexed line in the popup. */
const clickLine = (n) => inFrame(`document.querySelector('[data-line="${n}"]').click()`)

// Play a competent 2/3 — clicking blindly gave a 0/3 grid, a real playthrough and
// a miserable advert. The one miss is deliberate: the result screenshot needs a
// wrong pick to show BOTH the red line and the green one.
//
// Miss the snippet whose bug sits deepest. The reveal has to share a 600px popup
// with the result card, so a bug on line 4 scrolls out of frame above the
// explanation — and the screenshot then promises a reveal it does not show. A bug
// near the bottom lands right next to the card. Miss its neighbour, so the red and
// the green end up side by side.
const missId = daily.reduce((a, b) => (b.bug_line > a.bug_line ? b : a)).id

for (const [i, c] of daily.entries()) {
  if (i > 0) {
    await inFrame(`document.querySelector('.result .btn--primary').click()`)
    await sleep(1800)
  }

  const miss = c.id === missId
  await clickLine(miss ? (c.bug_line === 1 ? 2 : c.bug_line - 1) : c.bug_line)
  await sleep(1700)

  if (miss) {
    await inFrame(`
      document.querySelector('.result')?.scrollIntoView({ block: 'end' });
      return true;
    `)
    await sleep(700)
    await shoot('2-result')
  }
}

await inFrame(`document.querySelector('.result .btn--primary').click()`)
await sleep(1800)
await shoot('3-summary')

await inFrame(`document.querySelector('.summary .btn--ghost').click()`)
await sleep(800)
await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Leaderboard')).click()`)
await sleep(2200)
await shoot('4-leaderboard')

await inFrame(`document.querySelector('.topbar__back').click()`)
await sleep(700)
await inFrame(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Profile')).click()`)
await sleep(2200)
await shoot('5-profile')

ws.close(); chrome.kill(); server.close(); process.exit(0)
