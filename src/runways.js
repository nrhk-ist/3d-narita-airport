import * as THREE from 'three';
import { project } from './geo.js';
import { toVec } from './terrain.js';

// 滑走路の両端 (末端の白線の中央)。国土地理院のシームレス空中写真 (z16) から読み取った。
// 写真から求めた長さは A 約 3,960 m、B 約 2,460 m (公表値 4,000 m、2,500 m)。
export const RUNWAYS = [
  {
    key: 'A', name: 'A滑走路', ends: ['16R', '34L'], width: 60,
    north: [140.368474, 35.774215], south: [140.390596, 35.743447],
  },
  {
    key: 'B', name: 'B滑走路', ends: ['16L', '34R'], width: 60,
    north: [140.378258, 35.805041], south: [140.392013, 35.785948],
  },
].map((r) => {
  const n = project(...r.north), s = project(...r.south);
  const len = Math.hypot(n.x - s.x, n.y - s.y);
  // 南端から北端へ向かう単位ベクトル (北向きに運用する場合の進行方向)
  const u = { x: (n.x - s.x) / len, y: (n.y - s.y) / len };
  return { ...r, n, s, len, u };
});

/** 滑走路の面を地形に沿って作る */
export function buildRunways(ground) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3d42, polygonOffset: true, polygonOffsetFactor: -4 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, polygonOffset: true, polygonOffsetFactor: -8 });
  const meshes = [];
  for (const r of RUNWAYS) {
    const strip = (w, from, to, lift) => {
      const steps = Math.max(2, Math.ceil((to - from) / 50));
      const px = -r.u.y, py = r.u.x; // 横方向
      const pos = [], idx = [];
      for (let k = 0; k <= steps; k++) {
        const t = from + ((to - from) * k) / steps;
        const cx = r.s.x + r.u.x * t, cy = r.s.y + r.u.y * t;
        for (const side of [-1, 1]) {
          const x = cx + px * side * w / 2, y = cy + py * side * w / 2;
          const v = toVec(x, y, ground(x, y) + lift);
          pos.push(v.x, v.y, v.z);
        }
        if (k) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const body = new THREE.Mesh(strip(r.width, -60, r.len + 60, 1.2), mat);
    group.add(body);
    meshes.push(body);
    // 中心線 (破線)
    for (let t = 300; t < r.len - 300; t += 60) group.add(new THREE.Mesh(strip(1.5, t, t + 30, 1.4), lineMat));
    // 末端の白線
    for (const t of [10, r.len - 40]) group.add(new THREE.Mesh(strip(r.width - 8, t, t + 30, 1.4), lineMat));
  }
  return { group, meshes, update: () => {} };
}

/** 滑走路上の位置 (南端からの距離 t, m) の座標と地面の高さ */
export function along(r, t, ground) {
  const x = r.s.x + r.u.x * t, y = r.s.y + r.u.y * t;
  return { x, y, h: ground(x, y) + 1.2 };
}
