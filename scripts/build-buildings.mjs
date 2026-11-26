#!/usr/bin/env node
// 国土地理院ベクトルタイル (地理院地図Vector) の建物から、外観に立てる建物のデータを作る。
// データには建物の高さがないので、種類ごとに目安の高さを決める (src/buildings.js)。
//   入力: public/data/terrain.json (範囲), public/data/indoor/*.json (ターミナルは屋内データで描くので除く)
//   出力: public/data/buildings.bin
//     建物ごとに [種類 uint8][高さ m uint8][頂点数 uint16][頂点 (x, y) int16 × 頂点数] を並べる。
//     座標はシーン座標 (m) を 0.25 m 単位にしたもの。外周だけを使い、中庭などの穴は省く。
//
// 高さの目安: 普通建物 7 m、堅ろう建物 15 m、高層建物 40 m、無壁舎 5 m。
// 地理院のデータでは格納庫などの大きな建物も「普通建物」になっていることが多いので、
// 床面積が 3,000 m² 以上なら 15 m、10,000 m² 以上なら 25 m まで上げる (無壁舎は除く)。
import fs from 'node:fs/promises';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { project } from '../src/geo.js';

const OUT = 'public/data/buildings.bin';
const CACHE = '.cache/gsi/experimental_bvmap';
const Z = 16; // 建物が入っている最も細かいズーム
const UNIT = 0.25;
const TOLERANCE = 0.5; // 形を間引く許容誤差 (m)
// 地理院の建物の種類 (ftCode) → 出力する番号
const KINDS = { 3101: 1, 3102: 2, 3103: 3, 3111: 4, 3112: 4 };
const BASE_HEIGHT = { 1: 7, 2: 15, 3: 40, 4: 5 };
function heightOf(kind, area) {
  let h = BASE_HEIGHT[kind];
  if (kind !== 4) {
    if (area >= 10000) h = Math.max(h, 25);
    else if (area >= 3000) h = Math.max(h, 15);
  }
  return h;
}

const { bbox, extent } = JSON.parse(await fs.readFile('public/data/terrain.json', 'utf8'));
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z);

async function fetchTile(x, y) {
  const file = path.join(CACHE, `${Z}_${x}_${y}.pbf`);
  try {
    return await fs.readFile(file);
  } catch {}
  const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${Z}/${x}/${y}.pbf`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(file, buf);
      return buf;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// ターミナルの屋内の床 (1階以上) の外周。この中にある建物は屋内データの建物と重なるので除く
const terminals = [];
for (const id of ['T1', 'T2', 'T3']) {
  const data = JSON.parse(await fs.readFile(`public/data/indoor/${id}.json`, 'utf8'));
  for (const fl of data.floors) {
    if (fl.ordinal < 1) continue;
    for (const o of fl.outlines) {
      if (o.outdoor) continue;
      const ring = [];
      for (let i = 0; i < o.poly[0].length; i += 2) ring.push([o.poly[0][i] / 10, o.poly[0][i + 1] / 10]);
      terminals.push(ring);
    }
  }
}
function inside([px, py], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const x0 = tileX(bbox.west), x1 = tileX(bbox.east), y0 = tileY(bbox.north), y1 = tileY(bbox.south);
const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
// タイルには周りに少しはみ出した部分 (バッファ) があるので、タイルの範囲で切り取る
function clip(ring, E) {
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= E, (p) => p[1] >= 0, (p) => p[1] <= E,
  ];
  const cut = [
    (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])],
    (a, b) => [E, a[1] + ((b[1] - a[1]) * (E - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (E - a[1])) / (b[1] - a[1]), E],
  ];
  let pts = ring;
  for (let e = 0; e < 4; e++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ia = edges[e](a), ib = edges[e](b);
      if (ib) { if (!ia) out.push(cut[e](a, b)); out.push(b); }
      else if (ia) out.push(cut[e](a, b));
    }
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}
const shoelace = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
};

const pieces = []; // { kind, ring (m), area, bbox, edge, tile }
for (let i = 0; i < jobs.length; i += 8) {
  const bufs = await Promise.all(jobs.slice(i, i + 8).map(([x, y]) => fetchTile(x, y).then((b) => [x, y, b])));
  for (const [x, y, buf] of bufs) {
    if (!buf) continue;
    const layer = new VectorTile(new PbfReader(buf)).layers.building;
    if (!layer) continue;
    const E = layer.extent;
    const toLocal = ([px, py]) => {
      const lon = ((x + px / E) / 2 ** Z) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / E)) / 2 ** Z))) * 180) / Math.PI;
      const p = project(lon, lat);
      return [p.x, p.y];
    };
    for (let k = 0; k < layer.length; k++) {
      const f = layer.feature(k);
      const kind = KINDS[f.properties.ftCode];
      if (!kind || f.type !== 3) continue; // 面だけを使う (建物の外周の線も入っている)
      for (const raw of f.loadGeometry()) {
        let ring = raw.map((p) => [p.x, p.y]);
        if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
        if (shoelace(ring) <= 0) continue; // 穴 (外周は面積が正、穴は負)
        ring = clip(ring, E);
        if (ring.length < 3) continue;
        const edge = ring.some(([px, py]) => px === 0 || py === 0 || px === E || py === E);
        let m = ring.map(toLocal);
        m = simplify([...m, m[0]], TOLERANCE).slice(0, -1);
        if (m.length < 3) continue;
        const area = Math.abs(shoelace(m));
        if (area < 1) continue;
        const xs = m.map((p) => p[0]), ys = m.map((p) => p[1]);
        pieces.push({ kind, ring: m, area, edge, tile: `${x}_${y}`, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }
  }
}

// タイルの境目で分かれた 1 棟の建物は、床面積を合わせて高さを決める (同じ種類で、境目で接しているもの)
const parent = pieces.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const grid = new Map();
const CELL = 100;
pieces.forEach((p, i) => {
  if (!p.edge) return;
  for (let gx = Math.floor(p.bbox[0] / CELL); gx <= Math.floor(p.bbox[2] / CELL); gx++)
    for (let gy = Math.floor(p.bbox[1] / CELL); gy <= Math.floor(p.bbox[3] / CELL); gy++) {
      const key = `${gx},${gy}`;
      for (const j of grid.get(key) ?? []) {
        const q = pieces[j];
        const touch = p.bbox[0] <= q.bbox[2] + 0.3 && q.bbox[0] <= p.bbox[2] + 0.3 && p.bbox[1] <= q.bbox[3] + 0.3 && q.bbox[1] <= p.bbox[3] + 0.3;
        if (touch && q.kind === p.kind && q.tile !== p.tile) parent[find(i)] = find(j);
      }
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
});
const groupArea = new Map();
pieces.forEach((p, i) => groupArea.set(find(i), (groupArea.get(find(i)) ?? 0) + p.area));

const chunks = [];
let count = 0, skipped = 0;
const counts = {};
const heights = {};
pieces.forEach((p, i) => {
  const cx = p.ring.reduce((s, q) => s + q[0], 0) / p.ring.length;
  const cy = p.ring.reduce((s, q) => s + q[1], 0) / p.ring.length;
  // 地形の範囲からはみ出すもの (範囲の端のタイルにある建物) は出さない
  if (cx < extent.west + 20 || cx > extent.east - 20 || cy < extent.south + 20 || cy > extent.north - 20) return;
  if (terminals.some((t) => inside([cx, cy], t))) { skipped++; return; }
  const h = heightOf(p.kind, groupArea.get(find(i)));
  const b = Buffer.alloc(4 + p.ring.length * 4);
  b.writeUInt8(p.kind, 0);
  b.writeUInt8(h, 1);
  b.writeUInt16LE(p.ring.length, 2);
  p.ring.forEach(([px, py], n) => {
    b.writeInt16LE(Math.round(px / UNIT), 4 + n * 4);
    b.writeInt16LE(Math.round(py / UNIT), 6 + n * 4);
  });
  chunks.push(b);
  count++;
  counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  heights[h] = (heights[h] ?? 0) + 1;
});
const out = Buffer.concat(chunks);
await fs.writeFile(OUT, out);
console.log(`建物: ${count} 件 (${jobs.length} タイル、種類別 ${JSON.stringify(counts)}、高さ別 ${JSON.stringify(heights)}、ターミナルと重なる ${skipped} 件を除外), ${(out.length / 1024 / 1024).toFixed(1)} MB`);
