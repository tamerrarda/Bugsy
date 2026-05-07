/**
 * End-to-end test of the Milestone 3 daily flow, streak engine and badge engine
 * against the local Supabase stack.
 *
 * Streaks are inherently about the passage of days, which a test cannot wait for.
 * Instead we move `last_daily_date` backwards to stage the calendar, then let the
 * real server logic decide what happens — the logic under test is never stubbed.
 */

import { API, ANON, SERVICE } from '../../scripts/local-env.mjs'
let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} ${extra}`) }
}

const fn = (name, token, body) =>
  fetch(`${API}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

const db = (path, opts = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    // `...opts` FIRST: spreading it after `headers` would let an opts.headers
    // override drop the apikey and Authorization, and the request would go out
    // unauthenticated — silently doing nothing, which is the worst possible
    // failure mode in a test.
    ...opts,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  }).then(async (r) => (r.status === 204 ? null : r.json().catch(() => null)))

/** Creates a fresh player and returns { userId, jwt }. */
async function newPlayer(handle) {
  const email = `${handle}-${Date.now()}-${Math.round(performance.now())}@example.com`
  const user = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456', email_confirm: true, user_metadata: { user_name: handle } }),
  }).then((r) => r.json())

  const session = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456' }),
  }).then((r) => r.json())

  return { userId: user.id, jwt: session.access_token }
}

/**
 * Stages the calendar: pretend the player last completed a daily on `date`.
 * Verifies the write landed — a staging step that quietly no-ops would make the
 * streak tests pass or fail for reasons that have nothing to do with the engine.
 */
async function setStreak(userId, { dailyCurrent, lastDailyDate }) {
  const updated = await db(`streaks?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      daily_current: dailyCurrent,
      daily_best: dailyCurrent,
      last_daily_date: lastDailyDate,
    }),
  })

  if (!Array.isArray(updated) || updated.length !== 1 || updated[0].daily_current !== dailyCurrent) {
    throw new Error(`setStreak failed to stage the calendar: ${JSON.stringify(updated)}`)
  }
}

const truth = new Map(
  (await db('challenges?select=id,bug_line,difficulty&limit=1000')).map((c) => [c.id, c]),
)

// The daily is a per-language track now, so every test must name one. Python is a
// stable choice: it has content at every difficulty.
const TRACK = 'python'
const utcToday = new Date().toISOString().slice(0, 10)
const daysAgo = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Plays all three of today's daily challenges. `correctness` picks per index. */
async function playDaily(jwt, correctness = [true, true, true]) {
  const daily = await fn('get-daily', jwt, { language: TRACK })
  const results = []

  for (const [i, ch] of daily.body.challenges.entries()) {
    const bug = truth.get(ch.id).bug_line
    const line = correctness[i] ? bug : bug === 1 ? 2 : 1
    const r = await fn('submit-attempt', jwt, { challengeId: ch.id, mode: 'daily', clickedLine: line })
    results.push(r.body)
  }
  return { daily: daily.body, results }
}

// ---------------------------------------------------------------- 1
console.log('\n[1] get-daily: ayni gun, herkese ayni 3 soru')
const a = await newPlayer('daily-a')
const b = await newPlayer('daily-b')

const dailyA = await fn('get-daily', a.jwt, { language: TRACK })
const dailyB = await fn('get-daily', b.jwt, { language: TRACK })

ok(dailyA.status === 200, `200 (${dailyA.status})`, JSON.stringify(dailyA.body).slice(0, 120))
ok(dailyA.body.challenges.length === 3, `3 soru geldi (${dailyA.body.challenges.length})`)
ok(dailyA.body.day === utcToday, `gun UTC bugun (${dailyA.body.day})`)
ok(
  JSON.stringify(dailyA.body.challenges.map((c) => c.id)) ===
    JSON.stringify(dailyB.body.challenges.map((c) => c.id)),
  'iki farkli oyuncuya AYNI set verildi (anti-hile kural 4)',
)
ok(
  JSON.stringify(dailyA.body.challenges.map((c) => c.difficulty)) === JSON.stringify([1, 2, 3]),
  `zorluk sirasi kolay->zor (${dailyA.body.challenges.map((c) => c.difficulty).join(',')})`,
)
ok(
  dailyA.body.language === TRACK && dailyA.body.challenges.every((c) => c.language === TRACK),
  `pist tek dilli: 3 soru da ${TRACK} (bir Rust gelistiricisine C# sorusu gelmez)`,
)
ok(
  dailyA.body.challenges.every((c) => !('bugLine' in c) && !('explanation' in c)),
  'CEVAP SIZMIYOR: challenges icinde bugLine/explanation yok',
)
ok(dailyA.body.attempts.length === 0, 'henuz cevaplanmamis, attempts bos')

// ---------------------------------------------------------------- 2
console.log('\n[2] Yarim kalan gun kaldigi yerden devam ediyor')
const first = dailyA.body.challenges[0]
await fn('submit-attempt', a.jwt, {
  challengeId: first.id,
  mode: 'daily',
  clickedLine: truth.get(first.id).bug_line,
})
const resumed = await fn('get-daily', a.jwt, { language: TRACK })
ok(resumed.body.attempts.length === 1, `1 cevap hatirlandi (${resumed.body.attempts.length})`)
ok(resumed.body.attempts[0].correct === true, 'cevaplanan sorunun sonucu dondu')
ok(
  typeof resumed.body.attempts[0].explanation === 'string',
  'cevaplanan sorunun aciklamasi artik gorunuyor (dogru davranis)',
)
ok(
  resumed.body.challenges.every((c) => !('explanation' in c)),
  'ama cevaplanMAYAN sorularin aciklamasi hala gizli',
)

// ---------------------------------------------------------------- 3
console.log('\n[3] Streak: 3/3 bitirince artiyor (dogruluk degil, TAMAMLAMA)')
const c1 = await newPlayer('streak-c')
// Hepsini YANLIS cevapla — spec §4.1: "completion, not perfection".
const wrongRun = await playDaily(c1.jwt, [false, false, false])
const last = wrongRun.results[2]
ok(last.dailyComplete === true, 'gun tamamlandi olarak isaretlendi')
ok(last.streaks.dailyCurrent === 1, `hepsi YANLIS olmasina ragmen streak 1 (${last.streaks.dailyCurrent})`)
ok(wrongRun.results.every((r) => r.correct === false), 'gercekten 3/3 yanlisti')
ok(
  wrongRun.results[0].streaks.dailyCurrent === 0 && wrongRun.results[1].streaks.dailyCurrent === 0,
  'ilk iki soruda streak henuz artmadi (sadece 3/3 sayilir)',
)

// ---------------------------------------------------------------- 4
console.log('\n[4] Streak: dun oynanmissa zincir devam eder')
const c2 = await newPlayer('streak-d')
await setStreak(c2.userId, { dailyCurrent: 7, lastDailyDate: daysAgo(1) })
const cont = await playDaily(c2.jwt)
ok(cont.results[2].streaks.dailyCurrent === 8, `7 -> 8 (${cont.results[2].streaks.dailyCurrent})`)

// ---------------------------------------------------------------- 5
console.log('\n[5] Streak: bir gun atlanirsa SIFIRLANIR')
const c3 = await newPlayer('streak-e')
await setStreak(c3.userId, { dailyCurrent: 40, lastDailyDate: daysAgo(2) })
const broken = await playDaily(c3.jwt)
ok(broken.results[2].streaks.dailyCurrent === 1, `40 -> 1 (gun atlandi) (${broken.results[2].streaks.dailyCurrent})`)
ok(broken.results[2].streaks.dailyBest === 40, `dailyBest 40 korundu (${broken.results[2].streaks.dailyBest})`)

// ---------------------------------------------------------------- 6
console.log('\n[6] Rozetler (sunucuda, ayni transaction icinde)')
const c4 = await newPlayer('badge-f')
const firstDaily = await playDaily(c4.jwt)
const allBadges = firstDaily.results.flatMap((r) => r.newBadges.map((x) => x.id))
ok(allBadges.includes('first-daily'), `first-daily verildi (${allBadges.join(',') || 'yok'})`)

// Ayni gunu tekrar oynayamaz; streak'i 4'e kurup yeni bir gun oynatalim -> streak-5
const c5 = await newPlayer('badge-g')
await setStreak(c5.userId, { dailyCurrent: 4, lastDailyDate: daysAgo(1) })
const fifth = await playDaily(c5.jwt)
const fifthBadges = fifth.results.flatMap((r) => r.newBadges.map((x) => x.id))
ok(fifth.results[2].streaks.dailyCurrent === 5, 'streak 5 oldu')
ok(fifthBadges.includes('streak-5'), `streak-5 rozeti verildi (${fifthBadges.join(',')})`)

// Rozet iki kez verilmez
const c6 = await newPlayer('badge-h')
await setStreak(c6.userId, { dailyCurrent: 4, lastDailyDate: daysAgo(1) })
await playDaily(c6.jwt)
const held = await db(`user_badges?user_id=eq.${c6.userId}&select=badge_id`)
const ids = held.map((x) => x.badge_id).sort()
ok(new Set(ids).size === ids.length, `rozetler tekrarsiz (${ids.join(',')})`)

// speed-10: sunucu olctugu icin hizli cevap rozeti kazanir
const c7 = await newPlayer('badge-speed')
const served = await fn('get-practice', c7.jwt, {})
const fast = await fn('submit-attempt', c7.jwt, {
  challengeId: served.body.id,
  mode: 'practice',
  clickedLine: truth.get(served.body.id).bug_line,
})
ok(
  fast.body.newBadges.some((x) => x.id === 'speed-10'),
  `speed-10 verildi (10sn altinda) (${fast.body.newBadges.map((x) => x.id).join(',') || 'yok'})`,
)

// acc-10: 10 dogru ust uste
const c8 = await newPlayer('badge-acc')
let accBadge = false
for (let i = 0; i < 10; i++) {
  const s = await fn('get-practice', c8.jwt, {})
  if (s.status !== 200) break
  const r = await fn('submit-attempt', c8.jwt, {
    challengeId: s.body.id,
    mode: 'practice',
    clickedLine: truth.get(s.body.id).bug_line,
  })
  if (r.body.newBadges.some((x) => x.id === 'acc-10')) accBadge = true
}
ok(accBadge, 'acc-10 verildi (10 dogru ust uste)')

// ---------------------------------------------------------------- 7
console.log('\n[7] Gunluk sonuclar degismez (tekrar yok)')
const retry = await fn('submit-attempt', c4.jwt, {
  challengeId: firstDaily.daily.challenges[0].id,
  mode: 'daily',
  clickedLine: 1,
})
ok(retry.status === 409, `ayni gunluk soru tekrar cevaplanamiyor (${retry.status})`)

console.log(`\n${'='.repeat(50)}\n${pass} GECTI, ${fail} KALDI\n${'='.repeat(50)}`)
process.exit(fail > 0 ? 1 : 0)
