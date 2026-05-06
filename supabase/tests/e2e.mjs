/**
 * End-to-end test of the Milestone 2 backend against the local Supabase stack.
 * Drives the real Edge Functions over HTTP with a real user JWT.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { API, ANON, SERVICE } from '../../scripts/local-env.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

const fn = (name, token, body, method = 'POST') =>
  fetch(`${API}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

const db = (path, opts = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    // `...opts` FIRST. Spreading it after `headers` lets an opts.headers override
    // drop the apikey and Authorization, and the request goes out unauthenticated
    // — silently doing nothing, the worst possible failure mode in a test.
    ...opts,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  }).then(async (r) => (r.status === 204 ? null : r.json().catch(() => null)))

// --- 1. create a user (exercises the handle_new_user trigger) ---
console.log('\n[1] Kullanici olustur (handle_new_user trigger)')
const email = `bugsy-${Date.now()}@example.com`
const created = await fetch(`${API}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email,
    password: 'bugsy-test-pw-123',
    email_confirm: true,
    user_metadata: { user_name: 'octocat', avatar_url: 'https://example.com/a.png' },
  }),
}).then((r) => r.json())

ok(!!created.id, 'auth kullanicisi olusturuldu', JSON.stringify(created).slice(0, 120))
const userId = created.id

const profiles = await db(`profiles?id=eq.${userId}&select=username,avatar_url`)
ok(profiles?.length === 1, 'trigger profiles satirini olusturdu')
// Repeat runs reuse the GitHub handle "octocat", and username is UNIQUE — so the
// trigger's collision walk appends a suffix rather than failing the signup.
ok(
  /^octocat(-\d+)?$/.test(profiles?.[0]?.username ?? ''),
  `username GitHub metadata'sindan turetildi (${profiles?.[0]?.username})`,
)
const streaks = await db(`streaks?user_id=eq.${userId}&select=accuracy_current`)
ok(streaks?.length === 1, 'trigger streaks satirini olusturdu')

// --- 2. sign in ---
console.log('\n[2] Giris yap, JWT al')
const session = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'bugsy-test-pw-123' }),
}).then((r) => r.json())
const jwt = session.access_token
ok(!!jwt, 'access_token alindi')

// --- 3. auth gerekliligi ---
console.log('\n[3] Auth zorunlulugu')
const noAuth = await fn('get-practice', null, {})
ok(noAuth.status === 401, `token'siz get-practice 401 dondu (${noAuth.status})`)

// --- 4. get-practice ---
console.log('\n[4] get-practice')
const served = await fn('get-practice', jwt, {})
ok(served.status === 200, `200 dondu (${served.status})`, JSON.stringify(served.body).slice(0, 150))
const ch = served.body
ok(!!ch?.id && !!ch?.code, 'challenge dondu')
ok(!('bugLine' in (ch ?? {})) && !('bug_line' in (ch ?? {})), 'CEVAP SIZMIYOR: bugLine yok')
ok(!('explanation' in (ch ?? {})), 'CEVAP SIZMIYOR: explanation yok')
ok(
  JSON.stringify(Object.keys(ch ?? {}).sort()) === JSON.stringify(['category', 'code', 'difficulty', 'id', 'language']),
  `sadece izin verilen alanlar: ${Object.keys(ch ?? {}).sort().join(',')}`,
)

const serveRow = await db(`serves?user_id=eq.${userId}&challenge_id=eq.${ch.id}&select=served_at,mode`)
ok(serveRow?.length === 1, 'sunucu served_at kaydetti (zamanlama sunucuda)')

// --- 5. dil filtresi ---
console.log('\n[5] Dil filtresi')
const py = await fn('get-practice', jwt, { language: 'python' })
ok(py.body?.language === 'python', `python filtresi calisti (${py.body?.language})`)
// NOT 'rust' — that is a real language now. A rejection test that names a language
// we later add stops testing anything the day we add it, and does so silently.
const bad = await fn('get-practice', jwt, { language: 'cobol' })
ok(bad.status === 400, `bilinmeyen dil reddedildi (${bad.status})`)

// --- 6. gecersiz satir ---
console.log('\n[6] submit-attempt reddetme yollari')
const lineCount = ch.code.split('\n').length
const tooBig = await fn('submit-attempt', jwt, { challengeId: ch.id, mode: 'practice', clickedLine: lineCount + 50 })
ok(tooBig.status === 400, `aralik disi satir reddedildi (${tooBig.status}: ${tooBig.body?.error})`)

const neg = await fn('submit-attempt', jwt, { challengeId: ch.id, mode: 'practice', clickedLine: -1 })
ok(neg.status === 400, `negatif satir reddedildi (${neg.status})`)

const unserved = await fn('submit-attempt', jwt, {
  challengeId: '00000000-0000-4000-8000-000000000000',
  mode: 'practice',
  clickedLine: 1,
})
ok(unserved.status === 404, `bilinmeyen challenge reddedildi (${unserved.status})`)

// Only ACTIVE challenges: a retired one is genuinely unknown to the game, and
// picking one here would test the wrong rejection path.
const all = await db('challenges?active=eq.true&select=id,bug_line,difficulty&limit=500')

// Derived from content/, not hardcoded — the scored pool grows, and a test that
// has to be edited every time content lands is a test people learn to ignore.
const bundledCount = JSON.parse(
  readFileSync(new URL('../../extension/src/generated/challenges.json', import.meta.url), 'utf8'),
).length
const contentCount = execFileSync(
  'node',
  ['-e', "const fs=require('fs'),p=require('path');const w=(d)=>fs.readdirSync(d).flatMap(e=>{const f=p.join(d,e);return fs.statSync(f).isDirectory()?w(f):(e.endsWith('.json')?[f]:[])});console.log(w('content').length)"],
  { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' },
).trim()

const expectedScored = Number(contentCount) - bundledCount
ok(
  all.length === expectedScored,
  `DB'de ${expectedScored} aktif puanli soru var (${all.length}) — content ${contentCount} eksi guest ${bundledCount}`,
)
const notServed = all.find((c) => c.id !== ch.id && c.id !== py.body?.id)
const neverServed = await fn('submit-attempt', jwt, { challengeId: notServed.id, mode: 'practice', clickedLine: 1 })
ok(neverServed.status === 409, `hic sunulmamis challenge reddedildi (${neverServed.status}: ${neverServed.body?.error})`)

// --- 7. yanlis cevap ---
console.log('\n[7] Yanlis cevap')
const truth = all.find((c) => c.id === ch.id)
const wrongLine = truth.bug_line === 1 ? 2 : 1
const wrong = await fn('submit-attempt', jwt, { challengeId: ch.id, mode: 'practice', clickedLine: wrongLine })
ok(wrong.status === 200, `200 (${wrong.status})`)
ok(wrong.body?.correct === false, 'correct=false')
ok(wrong.body?.points === 0, `puan 0 (${wrong.body?.points})`)
ok(wrong.body?.bugLine === truth.bug_line, `gercek bugLine ancak SIMDI aciklandi (${wrong.body?.bugLine})`)
ok(typeof wrong.body?.explanation === 'string' && wrong.body.explanation.length > 20, 'explanation ancak simdi geldi')
ok(wrong.body?.streaks?.accuracyCurrent === 0, 'accuracy streak sifirlandi')

// --- 8. cift gonderim ---
console.log('\n[8] Cift gonderim (unique kisit)')
const again = await fn('submit-attempt', jwt, { challengeId: ch.id, mode: 'practice', clickedLine: truth.bug_line })
ok(again.status === 409, `ikinci deneme reddedildi (${again.status}: ${again.body?.error})`)
const attemptRows = await db(`attempts?user_id=eq.${userId}&challenge_id=eq.${ch.id}&select=id`)
ok(attemptRows?.length === 1, 'DB\'de tek attempt satiri var')

// --- 9. dogru cevap + puan + streak ---
console.log('\n[9] Dogru cevap, puanlama, streak')
const next = await fn('get-practice', jwt, {})
const nextTruth = all.find((c) => c.id === next.body.id)
const right = await fn('submit-attempt', jwt, { challengeId: next.body.id, mode: 'practice', clickedLine: nextTruth.bug_line })
ok(right.body?.correct === true, 'correct=true')
const base = nextTruth.difficulty * 100
ok(
  right.body?.points >= base && right.body?.points <= base + 120,
  `puan formulu: ${right.body?.points} (base ${base} + zaman bonusu <=120)`,
)
ok(right.body?.streaks?.accuracyCurrent === 1, `accuracy streak 1 (${right.body?.streaks?.accuracyCurrent})`)

// --- 10. timeout sentinel ---
console.log('\n[10] Timeout (clickedLine: 0)')
const third = await fn('get-practice', jwt, {})
const timeout = await fn('submit-attempt', jwt, { challengeId: third.body.id, mode: 'practice', clickedLine: 0 })
ok(timeout.status === 200, `kabul edildi (${timeout.status})`)
ok(timeout.body?.correct === false && timeout.body?.points === 0, 'yanlis sayildi, 0 puan')
const timeoutRow = await db(`attempts?user_id=eq.${userId}&challenge_id=eq.${third.body.id}&select=clicked_line`)
ok(timeoutRow?.[0]?.clicked_line === 0, 'DB\'ye clicked_line=0 yazildi -> tekrar denenemez')
ok(timeout.body?.streaks?.accuracyCurrent === 0, 'timeout streak\'i sifirladi')

// --- 11. get-practice ayni soruyu tekrar vermez ---
console.log('\n[11] Oynanmis soru tekrar sunulmuyor')
const played = new Set([ch.id, next.body.id, third.body.id])
const fresh = await fn('get-practice', jwt, {})
ok(fresh.status === 200 && !played.has(fresh.body.id), `yeni bir soru geldi (${fresh.body?.id?.slice(0, 8)})`)

// --- 11b. guest havuzu sunucudan ASLA servis edilmemeli ---
console.log('\n[11b] Guest havuzu sunucuda emekli (cevaplari pakette!)')
const bundled = JSON.parse(
  readFileSync(new URL("../../extension/src/generated/challenges.json", import.meta.url), 'utf8'),
)
const bundledIds = new Set(bundled.map((c) => c.id))
ok(bundledIds.size === 5, `pakette ${bundledIds.size} guest snippet var`)

const activeIds = new Set(all.map((c) => c.id))
const overlap = [...bundledIds].filter((id) => activeIds.has(id))
ok(overlap.length === 0, `pakettekilerin hicbiri sunucuda AKTIF degil (kesisim ${overlap.length})`)

// The retirement mechanism is what closes the leak, so test it by CAUSING the
// leak: shove a bundled guest snippet into the scored pool as active — exactly
// the state an upsert-only seed used to leave behind — then let the real seed
// script run and prove it gets retired.
const smuggled = bundled[0]
await db('challenges', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([
    {
      id: smuggled.id,
      language: smuggled.language,
      difficulty: smuggled.difficulty,
      category: smuggled.category,
      code: smuggled.code,
      bug_line: smuggled.bugLine,
      explanation: smuggled.explanation,
      source: 'handwritten',
      active: true,
    },
  ]),
})

const smuggledActive = await db(`challenges?id=eq.${smuggled.id}&select=active`)
ok(smuggledActive?.[0]?.active === true, 'guest snippet kasten AKTIF olarak DB\'ye sokuldu (sizinti kuruldu)')

execFileSync('node', ['scripts/seed.ts'], {
  cwd: new URL('../..', import.meta.url).pathname,
  stdio: 'ignore',
})

const afterSeed = await db(`challenges?id=eq.${smuggled.id}&select=active`)
ok(afterSeed?.[0]?.active === false, 'seed onu emekliye ayirdi (active=false) -> sizinti kapandi')

// And even asked for by id, it can no longer be answered for points.
const retiredAttempt = await fn('submit-attempt', jwt, {
  challengeId: smuggled.id,
  mode: 'practice',
  clickedLine: 1,
})
ok(retiredAttempt.status === 404, `emekli soru puanlanamiyor (${retiredAttempt.status})`)

// Play the whole scored pool: no bundled snippet may ever be served.
console.log('\n[11c] Tum puanli havuz gezildi, guest snippet cikmadi')
const servedIds = new Set()
for (let i = 0; i < 22; i++) {
  const r = await fn('get-practice', jwt, {})
  if (r.status !== 200) break
  servedIds.add(r.body.id)
  await fn('submit-attempt', jwt, { challengeId: r.body.id, mode: 'practice', clickedLine: 0 })
}
const leaked = [...servedIds].filter((id) => bundledIds.has(id))
ok(leaked.length === 0, `${servedIds.size} soru servis edildi, hicbiri paketten degil (sizinti ${leaked.length})`)

// --- 12. leaderboard ---
console.log('\n[12] Leaderboard (anon anahtariyla)')
const lb = await fetch(`${API}/rest/v1/leaderboard_alltime?select=*`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
}).then((r) => r.json())
ok(Array.isArray(lb) && lb.length >= 1, `leaderboard okunabiliyor (${lb?.length} satir)`)

// Find THIS run's user rather than assuming it tops the board — earlier runs left
// their own scores behind, which is exactly what a leaderboard is supposed to do.
const me = profiles[0].username
const myRow = lb.find((row) => row.username === me)
ok(!!myRow && myRow.points > 0, `bu kosunun kullanicisi tabloda: ${me} = ${myRow?.points} puan, sira ${myRow?.rank}`)
ok(
  lb.every((row, i) => i === 0 || lb[i - 1].points >= row.points),
  'puana gore azalan siralanmis',
)
ok(
  lb?.[0] && !('user_id' in lb[0]) && !('challenge_id' in lb[0]),
  `sadece izin verilen alanlar sizdiriliyor: ${Object.keys(lb?.[0] ?? {}).join(',')}`,
)

console.log(`\n${'='.repeat(50)}\n${pass} GECTI, ${fail} KALDI\n${'='.repeat(50)}`)
process.exit(fail > 0 ? 1 : 0)
