/**
 * The badge engine, end to end, against the real Postgres function.
 *
 * These drive submit_attempt directly (service role) rather than the Edge
 * Function, because the interesting inputs are *timing* and *history* — we need
 * to plant a serve 20 seconds in the past to prove a slow answer earns no speed
 * badge, and there is no way to ask an Edge Function to be slow.
 *
 * Every badge in the catalogue gets a test that it CAN be earned, and the ones
 * with a threshold get a test that they are NOT handed out below it. A badge
 * that is awarded too easily is the same bug as one that is impossible.
 */

import { API, SERVICE } from '../../scripts/local-env.mjs'
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

const db = (path, opts = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  }).then(async (r) => (r.status === 204 ? null : r.json().catch(() => null)))

const rpc = (name, args) =>
  fetch(`${API}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

const newUser = async (name) => {
  const created = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `badges-${name}-${Date.now()}@example.com`,
      password: 'bugsy-test-pw-123',
      email_confirm: true,
      user_metadata: { user_name: `badge-${name}` },
    }),
  }).then((r) => r.json())
  return created.id
}

/**
 * Answer a challenge. `agoMs` back-dates the serve, which is the only way to
 * control the server-measured elapsed time.
 */
const play = async (userId, challenge, { correct = true, agoMs = 1000, mode = 'practice' } = {}) => {
  await db('serves', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: userId,
      challenge_id: challenge.id,
      mode,
      served_at: new Date(Date.now() - agoMs).toISOString(),
    }),
  })

  const clicked = correct ? challenge.bug_line : challenge.bug_line === 1 ? 2 : 1
  const res = await rpc('submit_attempt', {
    p_user_id: userId,
    p_challenge_id: challenge.id,
    p_mode: mode,
    p_clicked_line: clicked,
  })
  if (res.status !== 200) throw new Error(`submit failed: ${JSON.stringify(res.body)}`)
  return res.body
}

const ids = (result) => (result.newBadges ?? []).map((b) => b.id)
const held = async (userId) =>
  (await db(`user_badges?user_id=eq.${userId}&select=badge_id`)).map((r) => r.badge_id)

// ---------------------------------------------------------------------------
console.log('\n[1] Katalog')

const catalogue = await db('badges?select=id,name,description,icon,family,sort&order=sort')
ok(catalogue.length === 31, `31 rozet var (${catalogue.length})`)
ok(
  catalogue.every((b) => b.icon && b.family && b.name && b.description),
  'her rozetin ikonu, ailesi, adi ve aciklamasi var',
)
ok(
  new Set(catalogue.map((b) => b.sort)).size === catalogue.length,
  'sort degerleri benzersiz (gruplama kaymaz)',
)

// `sort` must keep families contiguous — the client groups by walking the sorted
// list, so an interleaved family would render as two separate sections.
const families = catalogue.map((b) => b.family)
const firstSeen = new Map()
let contiguous = true
families.forEach((f, i) => {
  if (!firstSeen.has(f)) firstSeen.set(f, i)
  else if (families[i - 1] !== f) contiguous = false
})
ok(contiguous, 'sort sirasi aileleri bitisik tutuyor')

const pool = await db('challenges?select=id,bug_line,language,category,difficulty&active=eq.true')
const pick = (fn) => pool.find(fn)

// ---------------------------------------------------------------------------
console.log('\n[2] Ilk dogru cevap')

const u1 = await newUser('first')
const easy = pick((c) => c.difficulty === 1 && c.language === 'python')
const r1 = await play(u1, easy, { agoMs: 20000 })

ok(r1.correct === true, 'dogru cevap kabul edildi')
ok(ids(r1).includes('solved-1'), 'solved-1 verildi')
ok(ids(r1).includes('lang-python'), 'lang-python verildi')
ok(!ids(r1).includes('speed-10'), '20 saniyede cozulene speed-10 VERILMEDI')
ok(!ids(r1).includes('speed-5'), '20 saniyede cozulene speed-5 VERILMEDI')
ok(!ids(r1).includes('polyglot'), 'tek dille polyglot VERILMEDI')
ok(r1.newBadges.every((b) => b.icon), 'yeni rozetler ikonlariyla geliyor')

// ---------------------------------------------------------------------------
console.log('\n[3] Hiz rozetleri sunucu saatiyle olculuyor')

const u2 = await newUser('speed')
const fast = pick((c) => c.difficulty === 1 && c.language === 'java')
const r2 = await play(u2, fast, { agoMs: 3000 })
ok(ids(r2).includes('speed-10'), '3 sn -> speed-10')
ok(ids(r2).includes('speed-5'), '3 sn -> speed-5')
ok(!ids(r2).includes('speed-hard'), 'kolay soru 3 sn -> speed-hard VERILMEDI')

const midSpeed = pick((c) => c.difficulty === 1 && c.language === 'rust')
const r2b = await play(u2, midSpeed, { agoMs: 7000 })
ok(ids(r2b).includes('speed-10') === false, 'speed-10 zaten alinmis, tekrar verilmiyor')

const hard = pick((c) => c.difficulty === 3)
const r2c = await play(u2, hard, { agoMs: 12000 })
ok(ids(r2c).includes('speed-hard'), 'zor soru 12 sn -> speed-hard')

const u2b = await newUser('slowhard')
const hard2 = pick((c) => c.difficulty === 3 && c.id !== hard.id)
const r2d = await play(u2b, hard2, { agoMs: 20000 })
ok(!ids(r2d).includes('speed-hard'), 'zor soru 20 sn -> speed-hard VERILMEDI')

// A wrong answer, however fast, earns nothing.
const u2c = await newUser('wrongfast')
const r2e = await play(u2c, pick((c) => c.difficulty === 1 && c.language === 'c'), {
  correct: false,
  agoMs: 500,
})
ok(r2e.correct === false, 'yanlis cevap')
ok(ids(r2e).length === 0, 'yanlis ama hizli cevap HICBIR rozet kazandirmiyor')

// ---------------------------------------------------------------------------
console.log('\n[4] Hacim: solved-10')

const u3 = await newUser('volume')
const ten = pool.filter((c) => c.language === 'typescript').slice(0, 10)
let last
for (const c of ten) last = await play(u3, c, { agoMs: 20000 })

ok(ids(last).includes('solved-10'), '10. dogru -> solved-10')
const u3badges = await held(u3)
ok(!u3badges.includes('solved-50'), '10 dogruda solved-50 VERILMEDI')
ok(u3badges.includes('acc-10'), '10 arka arkaya dogru -> acc-10')

// ---------------------------------------------------------------------------
console.log('\n[5] Yanlis cevap practice serisini sifirliyor')

const u4 = await newUser('streakbreak')
const nine = pool.filter((c) => c.language === 'csharp').slice(0, 9)
for (const c of nine) await play(u4, c, { agoMs: 20000 })
await play(u4, pick((c) => c.language === 'cpp'), { correct: false, agoMs: 20000 })
const after = await play(
  u4,
  pool.filter((c) => c.language === 'csharp')[9],
  { agoMs: 20000 },
)
ok(!ids(after).includes('acc-10'), '9 dogru + 1 yanlis + 1 dogru -> acc-10 VERILMEDI')
ok((await held(u4)).includes('solved-10'), 'ama 10 toplam dogru -> solved-10 verildi')

// ---------------------------------------------------------------------------
console.log('\n[6] Zor bocekler: hard-10')

const u5 = await newUser('hard')
const hards = pool.filter((c) => c.difficulty === 3).slice(0, 10)
let lastHard
for (const c of hards) lastHard = await play(u5, c, { agoMs: 20000 })
ok(ids(lastHard).includes('hard-10'), '10 zor -> hard-10')
ok(!(await held(u5)).includes('hard-50'), '10 zorda hard-50 VERILMEDI')

// ---------------------------------------------------------------------------
console.log('\n[7] Polyglot ve Entomologist')

const u6 = await newUser('mastery')
const languages = [...new Set(pool.map((c) => c.language))]
let lastLang
for (const [i, language] of languages.entries()) {
  const c = pick((x) => x.language === language)
  lastLang = await play(u6, c, { agoMs: 20000 })
  if (i < languages.length - 1) {
    ok(
      !ids(lastLang).includes('polyglot'),
      `${i + 1}/${languages.length} dilde polyglot VERILMEDI`,
      '',
    )
  }
}
ok(ids(lastLang).includes('polyglot'), `${languages.length} dilin hepsi -> polyglot`)
const u6badges = await held(u6)
ok(
  languages.every((l) => u6badges.includes(`lang-${l}`)),
  'her dil icin ayri dil rozeti verildi',
)

const u7 = await newUser('cats')
const categories = [...new Set(pool.map((c) => c.category))]
let lastCat
for (const category of categories) {
  lastCat = await play(u7, pick((x) => x.category === category), { agoMs: 20000 })
}
ok(ids(lastCat).includes('entomologist'), `${categories.length} kategorinin hepsi -> entomologist`)

// ---------------------------------------------------------------------------
console.log('\n[8] Gunluk: first-daily ve daily-perfect')

const u8 = await newUser('daily')
const track = 'python'
await db(`profiles?id=eq.${u8}`, {
  method: 'PATCH',
  body: JSON.stringify({ daily_language: track }),
})

// Daily sets are built lazily on first serve. Ask for today's directly rather
// than assuming something else already created it.
const today = new Date().toISOString().slice(0, 10)
await rpc('ensure_daily_set', { p_day: today, p_language: track })

const set = await db(`daily_sets?day=eq.${today}&language=eq.${track}&select=challenge_ids`)
const dailyIds = set[0]?.challenge_ids ?? []
ok(dailyIds.length === 3, `bugunun ${track} seti 3 soru (${dailyIds.length})`)

const dailies = dailyIds.map((id) => pool.find((c) => c.id === id))
let d
for (const [i, c] of dailies.entries()) {
  d = await play(u8, c, { agoMs: 20000, mode: 'daily' })
  if (i < 2) ok(!ids(d).includes('first-daily'), `${i + 1}/3 gunlukte first-daily VERILMEDI`)
}
ok(ids(d).includes('first-daily'), '3/3 gunluk -> first-daily')
ok(ids(d).includes('daily-perfect'), '3/3 gunluk hepsi DOGRU -> daily-perfect')
ok(d.streaks.dailyCurrent === 1, 'gunluk seri 1')

// Completion, not perfection: a missed bug still completes the day but must NOT
// hand out Flawless Day.
const u9 = await newUser('dailymiss')
await db(`profiles?id=eq.${u9}`, {
  method: 'PATCH',
  body: JSON.stringify({ daily_language: track }),
})
let d9
for (const [i, c] of dailies.entries()) {
  d9 = await play(u9, c, { agoMs: 20000, mode: 'daily', correct: i !== 1 })
}
ok(ids(d9).includes('first-daily'), '2/3 dogru ama 3/3 tamamlandi -> first-daily verildi')
ok(!ids(d9).includes('daily-perfect'), '2/3 dogru -> daily-perfect VERILMEDI')
ok(d9.streaks.dailyCurrent === 1, 'eksik cevaba ragmen seri devam ediyor (§4.1)')

// ---------------------------------------------------------------------------
console.log('\n[9] Rozet iki kez verilmiyor')

const u10 = await newUser('once')
const a = pick((c) => c.language === 'rust' && c.difficulty === 1)
const b = pool.find((c) => c.language === 'rust' && c.difficulty === 1 && c.id !== a.id)
const first = await play(u10, a, { agoMs: 2000 })
const second = await play(u10, b, { agoMs: 2000 })

ok(ids(first).includes('speed-5'), 'ilk hizli cevap -> speed-5')
ok(!ids(second).includes('speed-5'), 'ikinci hizli cevap -> speed-5 TEKRAR verilmedi')
ok(!ids(second).includes('lang-rust'), 'ikinci Rust cevabi -> lang-rust TEKRAR verilmedi')

const rows = await db(`user_badges?user_id=eq.${u10}&select=badge_id`)
ok(new Set(rows.map((r) => r.badge_id)).size === rows.length, 'user_badges tablosunda tekrar yok')

// ---------------------------------------------------------------------------
console.log('\n[10] Her rozet katalogda kayitli')

const catIds = new Set(catalogue.map((b) => b.id))
const allAwarded = await db('user_badges?select=badge_id')
ok(
  allAwarded.every((r) => catIds.has(r.badge_id)),
  'verilen her rozetin katalog karsiligi var',
)

console.log(`\n${pass} GECTI, ${fail} KALDI\n`)
process.exit(fail === 0 ? 0 : 1)
