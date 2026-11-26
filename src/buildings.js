import * as THREE from 'three';

// 外観に立てる周りの建物 (国土地理院ベクトルタイルの建物を、種類ごとの目安の高さで立ち上げたもの)。
// データの形式は scripts/build-buildings.mjs を参照。
const UNIT = 0.25;
const COLORS = {
  1: new THREE.Color(0xe9e4da), // 普通建物
  2: new THREE.Color(0xd5dae1), // 堅ろう建物
  3: new THREE.Color(0xc3ccd8), // 高層建物
  4: new THREE.Color(0xcfc7b6), // 無壁舎
};
const WALL_SHADE = 0.82; // 壁は屋根より少し暗くする

export async function loadBuildings(base) {
  const buf = new DataView(await fetch(`${base}data/buildings.bin`).then((r) => r.arrayBuffer()));
  const list = [];
  for (let o = 0; o < buf.byteLength;) {
    const kind = buf.getUint8(o), h = buf.getUint8(o + 1), n = buf.getUint16(o + 2, true);
    const ring = [];
    for (let i = 0; i < n; i++) ring.push([buf.getInt16(o + 4 + i * 4, true) * UNIT, buf.getInt16(o + 6 + i * 4, true) * UNIT]);
    list.push({ kind, h, ring });
    o += 4 + n * 4;
  }
  return list;
}

/**
 * 建物を 1 つのメッシュにまとめる。高さは「標高 + 建物の高さ」で作り、
 * 高低差の強調は mesh.scale.y で掛ける (地形と同じ倍率で建物も高くなる)。
 */
export function buildBuildingMesh(list, sample) {
  const pos = [], nor = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const b of list) {
    const ring = b.ring;
    let cx = 0, cy = 0, area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      cx += ring[i][0]; cy += ring[i][1];
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    cx /= ring.length; cy /= ring.length;
    const ccw = area > 0; // 北を上にしたとき反時計回り
    // 斜面の建物が浮かないよう、四隅のうち一番低いところを地面の高さにする
    let g = Infinity;
    for (const [x, y] of ring) g = Math.min(g, sample(x, y));
    g = Math.min(g, sample(cx, cy)) - 1;
    const top = g + 1 + b.h;
    const roof = COLORS[b.kind] ?? COLORS[1];

    // 壁
    c.copy(roof).multiplyScalar(WALL_SHADE);
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
      // 外向きの法線 (地図の座標 → シーンの x, -z)
      const nx = (ccw ? dy : -dy) / L, ny = (ccw ? -dx : dx) / L;
      const v = pos.length / 3;
      pos.push(x0, g, -y0, x1, g, -y1, x1, top, -y1, x0, top, -y0);
      for (let k = 0; k < 4; k++) { nor.push(nx, 0, -ny); col.push(c.r, c.g, c.b); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    // 屋根
    const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const v = pos.length / 3;
    for (const [x, y] of ring) {
      pos.push(x, top, -y);
      nor.push(0, 1, 0);
      col.push(roof.r, roof.g, roof.b);
    }
    for (const [a, b2, d] of tris) idx.push(v + a, v + b2, v + d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'buildings';
  return mesh;
}
