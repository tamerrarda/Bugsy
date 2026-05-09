/**
 * Turns the four mascot PNGs into transparent, popup-sized assets.
 *
 * Background removal is a flood fill from the image edges with a LOCAL tolerance:
 * a pixel joins the background if it is close to the neighbour it was reached
 * from, not to some fixed key colour. That walks smooth gradients and fake
 * checkerboards happily, but stops dead at Bugsy's hard outline — which matters,
 * because the outline (#2d2438) is nearly as dark and as desaturated as the grey
 * vignette behind it, so a global colour key would eat him alive.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'

const ROOT = '/Users/tamerarda/Desktop/Bugsy'
const OUT = `${ROOT}/extension/public/mascot`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 8907
const CDP_PORT = 9337

const SOURCES = {
  happy: "assets/mascot-source/Bugsy-base.png",
  celebrating: "assets/mascot-source/Bugsy-celebrate.png",
  dizzy: "assets/mascot-source/Bugsy-dizzy.png",
  sleeping: "assets/mascot-source/Bugsy-sleeping.png",
}

mkdirSync(OUT, { recursive: true })

// Serve the source PNGs so the page can load them into a canvas.
const server = createServer((req, res) => {
  // The page itself must come from this origin, or the canvas is "tainted" by
  // cross-origin image data and getImageData throws.
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><meta charset="utf-8"><title>mascot</title>')
    return
  }

  const name = decodeURIComponent(req.url.slice(1))
  let body
  try {
    body = readFileSync(`${ROOT}/${name}`)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'Content-Type': 'image/png' })
  res.end(body)
})
await new Promise((r) => server.listen(PORT, r))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-first-run',
  '--disable-gpu', `--user-data-dir=/tmp/bugsy-mascot-profile`, 'about:blank',
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

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` })
await new Promise((r) => setTimeout(r, 500))

const SCRIPT = (file, size) => `
(async () => {
  const img = new Image();
  img.src = 'http://127.0.0.1:${PORT}/${file}';
  await img.decode();

  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const corners = [[0,0],[W-1,0],[0,H-1],[W-1,H-1]].map(([x,y]) => {
    const i = (y*W+x)*4;
    return [d[i], d[i+1], d[i+2], d[i+3]];
  });

  // Flood fill from every edge pixel. Expand to a neighbour only if it is close
  // to the pixel we came FROM — a local tolerance, so smooth gradients and the
  // fake checkerboard are both traversed, while a hard outline blocks it.
  const TOL = 26;
  const bg = new Uint8Array(W*H);
  const stack = [];
  const push = (x, y) => { if (x>=0 && y>=0 && x<W && y<H && !bg[y*W+x]) { bg[y*W+x] = 1; stack.push(x, y); } };

  for (let x = 0; x < W; x++) { push(x, 0); push(x, H-1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W-1, y); }

  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const i = (y*W+x)*4;
    const r = d[i], g = d[i+1], b = d[i+2];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x+dx, ny = y+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      const ni = ny*W+nx;
      if (bg[ni]) continue;
      const j = ni*4;
      if (Math.abs(d[j]-r) + Math.abs(d[j+1]-g) + Math.abs(d[j+2]-b) <= TOL) {
        bg[ni] = 1; stack.push(nx, ny);
      }
    }
  }

  let cleared = 0;
  for (let p = 0; p < W*H; p++) if (bg[p]) { d[p*4+3] = 0; cleared++; }

  // Soften the 1px anti-aliased fringe the fill leaves behind: any surviving
  // pixel touching the background gets partial alpha, so Bugsy has no hard halo.
  const alpha = new Uint8Array(W*H);
  for (let p = 0; p < W*H; p++) alpha[p] = d[p*4+3];
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const p = y*W+x;
      if (bg[p] || alpha[p] === 0) continue;
      let touching = 0;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (bg[(y+dy)*W+(x+dx)]) touching++;
      if (touching) d[p*4+3] = Math.round(alpha[p] * (1 - 0.4 * touching / 4));
    }
  }

  ctx.putImageData(id, 0, 0);

  // Crop to Bugsy's actual bounds, then scale to the target size — the sources
  // have a lot of empty margin, which would otherwise waste half the pixels.
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y*W+x)*4+3] > 12) {
      if (x<minX) minX=x; if (x>maxX) maxX=x;
      if (y<minY) minY=y; if (y>maxY) maxY=y;
    }
  }
  const cw = maxX-minX+1, chh = maxY-minY+1;
  const side = Math.max(cw, chh);

  const out = document.createElement('canvas');
  out.width = ${size}; out.height = ${size};
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  // Centre the crop in a square so all four moods share one baseline.
  const dx = (side - cw) / 2, dy = (side - chh) / 2;
  const scale = ${size} / side;
  octx.drawImage(c, minX, minY, cw, chh, dx*scale, dy*scale, cw*scale, chh*scale);

  return {
    corners,
    cleared,
    pct: Math.round(cleared / (W*H) * 100),
    bounds: [minX, minY, maxX, maxY],
    dataUrl: out.toDataURL('image/png'),
  };
})()
`

console.log('kaynak  kose pikseli (RGBA)          temizlenen  kirpim')
for (const [mood, file] of Object.entries(SOURCES)) {
  const r = await evaluate(SCRIPT(file, 192))
  const corner = r.corners[0].join(',')
  console.log(
    `${mood.padEnd(12)} [${corner}]`.padEnd(42) +
      `${String(r.pct).padStart(3)}%      ${r.bounds.join(',')}`,
  )

  const b64 = r.dataUrl.split(',')[1]
  writeFileSync(`${OUT}/bugsy-${mood}.png`, Buffer.from(b64, 'base64'))
}

// Icons come from the happy face — that is the one people will recognise.
for (const size of [16, 32, 48, 128]) {
  const r = await evaluate(SCRIPT(SOURCES.happy, size))
  writeFileSync(
    `${ROOT}/extension/public/icons/icon-${size}.png`,
    Buffer.from(r.dataUrl.split(',')[1], 'base64'),
  )
}
console.log('\nikonlar 16/32/48/128 Bugsy-base.png dan uretildi')

ws.close(); chrome.kill(); server.close(); process.exit(0)
