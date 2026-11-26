#!/usr/bin/env node
// 屋内地図オープンデータ (Shapefile ZIP) から、画面で使うターミナル別の JSON を作る。
//   入力: data/source/mlit-indoor-narita-airport-r2/shapefile.zip
//   出力: public/data/indoor/T1.json, T2.json, T3.json, index.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { readShp, readDbf } from './lib/shp.mjs';
import { project } from '../src/geo.js';

const SRC = 'data/source/mlit-indoor-narita-airport-r2/shapefile.zip';
const OUT = 'public/data/indoor';
const TERMINALS = [
  { id: 'T1', dir: 'Terminal1', name: '第1ターミナル' },
  { id: 'T2', dir: 'Terminal2', name: '第2ターミナル' },
  { id: 'T3', dir: 'Terminal3', name: '第3ターミナル' },
];
// 画面に出さない什器 (視覚障害者誘導用ブロックなど細かすぎるもの)
const SKIP_FIXTURE = new Set(['C017', 'C018', 'C019']);
// 画面に出す設備の代表点 (階段・エレベーター・エスカレーター・スロープ・動く歩道・出入口・トイレ類)
const KEEP_POINT = /^F0(0[1-8]|1[1-5]|17)$/;
const TOLERANCE = 0.15; // 図形を間引く許容誤差 (m)

const zip = unzipSync(new Uint8Array(await fs.readFile(SRC)));
const files = new Map();
for (const [name, data] of Object.entries(zip)) files.set(name.replace(/\\/g, '/'), data);

/** フォルダ内の指定レイヤーを全部読む (第2ターミナル地下には駅・駐車場の別ファイルもある) */
function layer(terminalDir, folder, kind) {
  const shps = [...files.keys()].filter((k) => k.startsWith(`${terminalDir}/${folder}/`) && k.endsWith(`_${kind}.shp`));
  return shps.flatMap((name) => {
    const shapes = readShp(files.get(name));
    const rows = readDbf(files.get(name.replace(/\.shp$/, '.dbf')));
    return shapes.map((s, i) => ({ parts: s, ...rows[i] })).filter((r) => r.parts);
  });
}

const r1 = (v) => Math.round(v * 10); // 0.1 m 単位の整数にする

function toLocal(ring) {
  return ring.map(([lon, lat]) => {
    const p = project(lon, lat);
    return [p.x, p.y];
  });
}

function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      // 両端が同じ点 (閉じた輪) のときは、その点からの距離で測る
      const d = L < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[i][0] - r[j][0]) * (r[i][1] + r[j][1]);
  return s / 2; // 正: 時計回り
};
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 面の部品を [[外周, 穴...], ...] にする。
 *  回りの向きはデータによって揃っていないので、ほかの部品の内側にある部品を穴とみなす。 */
function polygons(parts) {
  const rings = parts.map((p) => simplify(toLocal(p), TOLERANCE)).filter((r) => r.length >= 4);
  const absA = rings.map((r) => Math.abs(area(r)));
  const order = rings.map((_, i) => i).sort((a, b) => absA[b] - absA[a]);
  const outers = [];
  for (const i of order) {
    const o = outers.find((poly) => absA[poly.idx] > absA[i] && inside(rings[i][0], rings[poly.idx]) && poly.holes.every((h) => !inside(rings[i][0], rings[h])));
    if (o) o.holes.push(i);
    else outers.push({ idx: i, holes: [] });
  }
  // 末尾の閉じ点を落とし、0.1 m 単位の平らな配列にする
  const flat = (ring) => ring.slice(0, -1).flatMap(([x, y]) => [r1(x), r1(y)]);
  return outers.map((o) => [flat(rings[o.idx]), ...o.holes.map((h) => flat(rings[h]))]);
}

const index = [];
let bboxAll = null;
for (const t of TERMINALS) {
  const folders = [...new Set([...files.keys()].filter((k) => k.startsWith(`${t.dir}/`)).map((k) => k.split('/')[1]))];
  const floors = new Map(); // ordinal → floor
  const floorOf = new Map(); // floor_id → ordinal
  for (const folder of folders) {
    for (const f of layer(t.dir, folder, 'Floor')) {
      const ord = Math.round(Number(f.ordinal));
      floorOf.set(f.id, ord);
      if (!floors.has(ord)) {
        floors.set(ord, { ordinal: ord, label: f.short_name, name: f.name, outlines: [], spaces: [], fixtures: [], points: [] });
      }
      const fl = floors.get(ord);
      if (ord !== 0 && f.category === '1') { fl.label = f.short_name; fl.name = f.name; }
      for (const poly of polygons(f.parts)) fl.outlines.push({ outdoor: f.category === '2' ? 1 : 0, poly });
    }
  }
  const at = (row) => floors.get(floorOf.get(row.floor_id));
  for (const folder of folders) {
    for (const s of layer(t.dir, folder, 'Space')) {
      const fl = at(s);
      if (!fl) continue;
      for (const poly of polygons(s.parts)) fl.spaces.push({ id: s.id, c: s.category, ...(s.name ? { n: s.name } : {}), poly });
    }
    for (const s of layer(t.dir, folder, 'Fixture')) {
      const fl = at(s);
      if (!fl || SKIP_FIXTURE.has(s.category)) continue;
      for (const poly of polygons(s.parts)) fl.fixtures.push({ c: s.category, poly });
    }
    for (const s of layer(t.dir, folder, 'Facility')) {
      const fl = at(s);
      if (!fl || !KEEP_POINT.test(s.category)) continue;
      const [lon, lat] = s.parts[0][0];
      const p = project(lon, lat);
      fl.points.push({ c: s.category, ...(s.name ? { n: s.name } : {}), x: r1(p.x), y: r1(p.y) });
    }
  }
  // 範囲
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const fl of floors.values()) for (const o of fl.outlines) for (const ring of o.poly) for (let i = 0; i < ring.length; i += 2) {
    bb = [Math.min(bb[0], ring[i]), Math.min(bb[1], ring[i + 1]), Math.max(bb[2], ring[i]), Math.max(bb[3], ring[i + 1])];
  }
  bb = bb.map((v) => v / 10);
  const list = [...floors.values()].sort((a, b) => a.ordinal - b.ordinal);
  const json = { id: t.id, name: t.name, bbox: bb, floors: list };
  await fs.mkdir(OUT, { recursive: true });
  const text = JSON.stringify(json);
  await fs.writeFile(path.join(OUT, `${t.id}.json`), text);
  const counts = (c) => list.reduce((n, f) => n + new Set(f.spaces.filter((s) => s.c === c).map((s) => s.id)).size, 0);
  index.push({ id: t.id, name: t.name, bbox: bb, floors: list.map((f) => ({ ordinal: f.ordinal, label: f.label, name: f.name })) });
  console.log(`${t.id}: ${list.map((f) => f.label).join(' ')} / 商業施設 ${counts('B001')} 階段 ${counts('B021')} EV ${counts('B022')} ES ${counts('B023')} / ${(text.length / 1024).toFixed(0)} KB`);
}
await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
