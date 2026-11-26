import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUPS, SPACE_NAMES, groupOf } from './categories.js';

export const FLOOR_H = 6; // 1 階あたりの高さの目安 (m)

/** 階 (ordinal) の床の高さ。0 (1階の屋外) と 1 (1階) は同じ高さ */
export const floorBase = (ord) => (ord >= 1 ? (ord - 1) * FLOOR_H : ord === 0 ? 0 : ord * FLOOR_H);

const toShape = (poly) => {
  const ring = (flat) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i] / 10, flat[i + 1] / 10));
    return pts;
  };
  const shape = new THREE.Shape(ring(poly[0]));
  for (const h of poly.slice(1)) shape.holes.push(new THREE.Path(ring(h)));
  return shape;
};

/** 面を床に置く形にする。h > 0 なら立ち上げる */
function polyGeometry(poly, base, h) {
  const shape = toShape(poly);
  const g = h > 0.1 ? new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, base + (h > 0.1 ? 0 : h), 0);
  return g;
}

function outlineGeometry(polys, y) {
  const pts = [];
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      pts.push(ring[i] / 10, y, -ring[i + 1] / 10, ring[j] / 10, y, -ring[j + 1] / 10);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function centroid(flat) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    const x0 = flat[i] / 10, y0 = flat[i + 1] / 10, x1 = flat[j] / 10, y1 = flat[j + 1] / 10;
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-6) return { x: flat[0] / 10, y: flat[1] / 10 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const materials = new Map();
function materialFor(g) {
  if (!materials.has(g.key)) {
    materials.set(g.key, new THREE.MeshLambertMaterial({
      color: g.color,
      transparent: g.opacity != null,
      opacity: g.opacity ?? 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }));
  }
  return materials.get(g.key);
}
const floorMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 }); // 区画のない部分 (非公開の部分など)
const outdoorMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
const fixtureMat = new THREE.MeshLambertMaterial({ color: 0x78716c });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.55 });
const ghostMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 });

function badge(text, color) {
  const el = document.createElement('div');
  el.className = 'badge';
  el.textContent = text;
  el.style.background = color;
  return new CSS2DObject(el);
}

/** ターミナル 1 棟分の屋内表示を作る */
export function buildTerminal(data) {
  const group = new THREE.Group();
  group.name = data.id;
  const floors = new Map();
  for (const fl of data.floors) {
    const base = floorBase(fl.ordinal);
    const detail = new THREE.Group();
    const pickables = [];
    const badges = new THREE.Group();

    // 床
    for (const o of fl.outlines) {
      const m = new THREE.Mesh(polyGeometry(o.poly, base - 0.3, 0.3), o.outdoor ? outdoorMat : floorMat);
      m.userData = { kind: 'floor', outdoor: o.outdoor, floor: fl };
      detail.add(m);
      pickables.push(m);
    }
    detail.add(new THREE.LineSegments(outlineGeometry(fl.outlines.map((o) => o.poly), base + 0.02), edgeMat));

    // 区画
    const edgePolys = [];
    const placed = [];
    for (const s of fl.spaces) {
      const g = groupOf(s.c);
      const m = new THREE.Mesh(polyGeometry(s.poly, base, g.h), materialFor(g));
      m.userData = { kind: 'space', code: s.c, name: s.n, group: g, floor: fl };
      detail.add(m);
      pickables.push(m);
      if (g.h > 0.1) edgePolys.push({ poly: s.poly, top: base + g.h });
      if (g.badge) {
        const c = centroid(s.poly[0]);
        // 隣り合う同じ種類の区画 (男女のトイレなど) はアイコンを 1 つにまとめる
        const near = placed.some((p) => p.key === g.key && Math.hypot(p.x - c.x, p.y - c.y) < 12);
        if (near) continue;
        placed.push({ key: g.key, ...c });
        const b = badge(g.badge, g.color);
        b.position.set(c.x, base + g.h + 1, -c.y);
        b.userData.groupKey = g.key;
        badges.add(b);
      }
    }
    // 立ち上げた区画の上端の縁取り
    const tops = new Map();
    for (const e of edgePolys) {
      if (!tops.has(e.top)) tops.set(e.top, []);
      tops.get(e.top).push(e.poly);
    }
    for (const [y, polys] of tops) detail.add(new THREE.LineSegments(outlineGeometry(polys, y + 0.01), edgeMat));

    // 柱・間仕切りなど
    const fx = fl.fixtures.map((f) => polyGeometry(f.poly, base, f.c === 'C001' ? 4 : 1.2));
    if (fx.length) detail.add(new THREE.Mesh(mergeGeometries(fx), fixtureMat));

    // 出入口の名前
    for (const p of fl.points) {
      if (p.c !== 'F017' || !p.n) continue;
      const el = document.createElement('div');
      el.className = 'label exit';
      el.textContent = p.n;
      const lab = new CSS2DObject(el);
      lab.position.set(p.x / 10, base + 2, -p.y / 10);
      lab.userData.groupKey = 'exit';
      badges.add(lab);
    }
    detail.add(badges);

    // ほかの階を表示しているときに出す輪郭
    const ghost = new THREE.LineSegments(outlineGeometry(fl.outlines.filter((o) => !o.outdoor).map((o) => o.poly), base), ghostMat);

    detail.visible = false;
    ghost.visible = false;
    group.add(detail, ghost);
    // 屋内部分の範囲 (カメラを合わせるため)
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const o of fl.outlines) if (!o.outdoor) for (let i = 0; i < o.poly[0].length; i += 2) {
      const x = o.poly[0][i] / 10, y = o.poly[0][i + 1] / 10;
      bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y);
    }
    floors.set(fl.ordinal, { info: fl, base, detail, ghost, pickables, badges, bbox: Number.isFinite(bb[0]) ? bb : data.bbox });
  }

  function showFloor(ord) {
    for (const [o, f] of floors) {
      f.detail.visible = o === ord;
      // 1階と1階屋外は同じ高さなので、一緒に出す
      if (ord === 1 && o === 0) f.detail.visible = true;
      f.ghost.visible = !f.detail.visible;
    }
  }
  function setBadgeFilter(enabled) {
    for (const f of floors.values()) for (const b of f.badges.children) b.visible = enabled.has(b.userData.groupKey);
  }
  const pickables = () => [...floors.values()].filter((f) => f.detail.visible).flatMap((f) => f.pickables);
  return { group, floors, showFloor, setBadgeFilter, pickables };
}

/** 外観で使う、ターミナルの建物のかたまり (各階の屋内の床を積み上げる) */
export function buildMassing(data) {
  const geos = [];
  for (const fl of data.floors) {
    if (fl.ordinal < 1) continue;
    for (const o of fl.outlines) if (!o.outdoor) geos.push(polyGeometry(o.poly, floorBase(fl.ordinal), FLOOR_H - 0.5));
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.userData = { kind: 'terminal', id: data.id, name: data.name };
  return mesh;
}

export function describe(ud) {
  if (ud.kind === 'space') {
    const lines = [];
    if (ud.code === 'B001') lines.push('店名はデータに含まれていません');
    return { title: ud.name || SPACE_NAMES[ud.code] || ud.group.name, sub: [SPACE_NAMES[ud.code] ?? ud.code, `${ud.floor.label}（${ud.floor.name}）`, ...lines] };
  }
  if (ud.kind === 'floor') return { title: ud.outdoor ? '屋外（歩道・乗り場など）' : '床', sub: [`${ud.floor.label}（${ud.floor.name}）`] };
  return null;
}

export { GROUPS };
