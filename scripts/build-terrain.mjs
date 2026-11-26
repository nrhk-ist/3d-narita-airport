#!/usr/bin/env node
// 国土地理院の標高タイルと空中写真から、外観の地形データを作る。
//   出力: public/data/terrain.json (範囲・格子の大きさ), public/data/terrain.bin (標高, Int16, 0.1 m 単位),
//         public/data/photo.jpg (地表に貼る空中写真)
// 出典: 国土地理院 標高タイル (DEM10B), シームレス空中写真
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { project } from '../src/geo.js';

const OUT = 'public/data';
const CACHE = '.cache/gsi';
// 表示する範囲 (経緯度)。空港全体と周りの土地が入るようにする。
const BBOX = { west: 140.325, east: 140.435, south: 35.715, north: 35.835 };
const DEM_Z = 14; // 標高タイル (dem_png) は z14 まで
const PHOTO_Z = 16;
const GRID = 25; // 標高の格子の間隔 (m)
const PHOTO_MAX = 4096; // 写真の長辺 (px)

const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

async function fetchTile(kind, z, x, y, ext) {
  const file = path.join(CACHE, kind, `${z}_${x}_${y}.${ext}`);
  try {
    return await fs.readFile(file);
  } catch {}
  const url = `https://cyberjapandata.gsi.go.jp/xyz/${kind}/${z}/${x}/${y}.${ext}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buf);
      return buf;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** タイルを並べて 1 枚の画像 (生の画素) にする */
async function mosaic(kind, z, ext) {
  const x0 = Math.floor(tileX(BBOX.west, z)), x1 = Math.floor(tileX(BBOX.east, z));
  const y0 = Math.floor(tileY(BBOX.north, z)), y1 = Math.floor(tileY(BBOX.south, z));
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
  const comp = [];
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  // 同時に取りに行く数を絞る
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(async ([x, y]) => {
      const buf = await fetchTile(kind, z, x, y, ext);
      if (buf) comp.push({ input: buf, left: (x - x0) * 256, top: (y - y0) * 256 });
    }));
  }
  console.log(`${kind} z${z}: ${jobs.length} タイル`);
  const img = sharp({ create: { width: W, height: H, channels: 3, background: { r: 128, g: 0, b: 0 } } }).composite(comp);
  return { img, x0, y0, W, H };
}

// 範囲をメートルに
const sw = project(BBOX.west, BBOX.south), ne = project(BBOX.east, BBOX.north);
const nx = Math.round((ne.x - sw.x) / GRID) + 1, ny = Math.round((ne.y - sw.y) / GRID) + 1;

// --- 標高 ---
{
  const { img, x0, y0, W, H } = await mosaic('dem_png', DEM_Z, 'png');
  const raw = await sharp(await img.png().toBuffer()).removeAlpha().raw().toBuffer();
  const heightAt = (px, py) => {
    const i = (Math.min(H - 1, Math.max(0, py)) * W + Math.min(W - 1, Math.max(0, px))) * 3;
    const v = raw[i] * 65536 + raw[i + 1] * 256 + raw[i + 2];
    if (v === 8388608) return NaN; // データなし
    return (v < 8388608 ? v : v - 16777216) * 0.01;
  };
  // 経緯度 → タイル画像の画素 (双一次補間)
  const sample = (lon, lat) => {
    const fx = (tileX(lon, DEM_Z) - x0) * 256 - 0.5, fy = (tileY(lat, DEM_Z) - y0) * 256 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const h = [heightAt(ix, iy), heightAt(ix + 1, iy), heightAt(ix, iy + 1), heightAt(ix + 1, iy + 1)];
    const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let s = 0, ws = 0;
    h.forEach((v, k) => { if (!Number.isNaN(v)) { s += v * w[k]; ws += w[k]; } });
    return ws ? s / ws : 0;
  };
  const heights = new Int16Array(nx * ny);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j++) {
    const lat = BBOX.north - (j / (ny - 1)) * (BBOX.north - BBOX.south);
    for (let i = 0; i < nx; i++) {
      const lon = BBOX.west + (i / (nx - 1)) * (BBOX.east - BBOX.west);
      const h = sample(lon, lat);
      heights[j * nx + i] = Math.round(h * 10);
      min = Math.min(min, h); max = Math.max(max, h);
    }
  }
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'terrain.bin'), Buffer.from(heights.buffer));
  await fs.writeFile(path.join(OUT, 'terrain.json'), JSON.stringify({
    bbox: BBOX,
    // シーン座標 (m)。行は北から南へ、列は西から東へ並ぶ
    extent: { west: sw.x, east: ne.x, south: sw.y, north: ne.y },
    nx, ny, scale: 0.1,
    min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10,
    source: '国土地理院 標高タイル (基盤地図情報数値標高モデル DEM10B)',
  }, null, 1));
  console.log(`標高: ${nx} x ${ny} 点, ${min.toFixed(1)}〜${max.toFixed(1)} m`);
}

// --- 空中写真 ---
{
  const { img, x0, y0 } = await mosaic('seamlessphoto', PHOTO_Z, 'jpg');
  const full = await img.png().toBuffer();
  const left = Math.round((tileX(BBOX.west, PHOTO_Z) - x0) * 256);
  const top = Math.round((tileY(BBOX.north, PHOTO_Z) - y0) * 256);
  const width = Math.round((tileX(BBOX.east, PHOTO_Z) - x0) * 256) - left;
  const height = Math.round((tileY(BBOX.south, PHOTO_Z) - y0) * 256) - top;
  // メルカトルの縦の伸びは範囲が狭いので無視できる (0.1% 未満)。長辺を PHOTO_MAX に縮める
  const k = PHOTO_MAX / Math.max(width, height);
  const { size } = await sharp(full)
    .extract({ left, top, width, height })
    .resize(Math.round(width * k), Math.round(height * k))
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(OUT, 'photo.jpg'));
  console.log(`写真: ${Math.round(width * k)} x ${Math.round(height * k)} px, ${(size / 1024 / 1024).toFixed(1)} MB`);
}
