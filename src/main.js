import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadTerrain, buildTerrainMesh, toVec } from './terrain.js';
import { RUNWAYS, buildRunways } from './runways.js';
import { createTraffic } from './planes.js';
import { buildTerminal, buildMassing, describe, GROUPS, floorBase } from './indoor.js';

const BASE = import.meta.env.BASE_URL;
const $ = (id) => document.getElementById(id);

// --- 描画の準備 ---
const container = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const SKY = new THREE.Color(0xbcd4ea);
const INDOOR_BG = new THREE.Color(0xaab7c4);
const scene = new THREE.Scene();
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(45, 1, 1, 120000);
// 操作は山梨・横浜の3Dマップと揃える: 左ドラッグ (1本指) で回転、右ドラッグ (2本指) で移動、
// ホイール (ピンチ) でカーソル位置に向かってズーム
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = false; // 移動は地面に沿って
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.zoomToCursor = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-3000, 6000, 2000);
scene.add(sun);

function resize() {
  document.documentElement.style.setProperty('--bar-h', `${$('bar').offsetHeight}px`);
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// ヘッダーの高さはボタンの折り返しで変わるので、変わるたびに合わせる
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${$('bar').offsetHeight}px`)).observe($('bar'));
resize();

function label(text, cls = 'label') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return new CSS2DObject(el);
}

// --- データの読み込み ---
const [terrain, photo, terminals] = await Promise.all([
  loadTerrain(BASE),
  new THREE.TextureLoader().loadAsync(`${BASE}data/photo.jpg`),
  fetch(`${BASE}data/indoor/index.json`).then((r) => r.json()).then((list) =>
    Promise.all(list.map((t) => fetch(`${BASE}data/indoor/${t.id}.json`).then((r) => r.json())))),
]);
photo.colorSpace = THREE.SRGBColorSpace;
photo.anisotropy = renderer.capabilities.getMaxAnisotropy();

// --- 外観 ---
const exterior = new THREE.Group();
scene.add(exterior);
const land = buildTerrainMesh(terrain, photo);
exterior.add(land.group);
let exaggeration = 2;
const ground = (x, y) => terrain.sample(x, y) * exaggeration;

let runways = null;
const runwayLabels = RUNWAYS.map((r) => {
  const l = label(`${r.name}（${r.ends[0]}/${r.ends[1]}）`, 'label big');
  exterior.add(l);
  return l;
});
const massing = terminals.map((t) => {
  const m = buildMassing(t);
  exterior.add(m);
  const l = label(t.name, 'label big');
  exterior.add(l);
  return { data: t, mesh: m, label: l };
});
const center = (t) => ({ x: (t.bbox[0] + t.bbox[2]) / 2, y: (t.bbox[1] + t.bbox[3]) / 2 });

function placeExterior() {
  land.setExaggeration(exaggeration);
  if (runways) {
    exterior.remove(runways.group);
    runways.group.traverse((o) => o.geometry?.dispose());
  }
  runways = buildRunways(ground);
  exterior.add(runways.group);
  RUNWAYS.forEach((r, i) => {
    // 滑走路の北寄りに名前を置く
    const t = r.len * 0.75;
    const x = r.s.x + r.u.x * t + -r.u.y * 160, y = r.s.y + r.u.y * t + r.u.x * 160;
    runwayLabels[i].position.copy(toVec(x, y, ground(x, y) + 30));
  });
  for (const m of massing) {
    const c = center(m.data);
    m.ground = ground(c.x, c.y);
    m.mesh.position.y = m.ground;
    m.label.position.copy(toVec(c.x, c.y, m.ground + 45));
  }
}
placeExterior();

const traffic = createTraffic(exterior);
traffic.warmUp(ground);
let planesOn = true;

// --- 屋内 ---
const indoor = new Map();
for (const t of terminals) {
  const view = buildTerminal(t);
  view.group.visible = false;
  scene.add(view.group);
  indoor.set(t.id, { data: t, view, floor: 1 });
}
const badgeKeys = new Set(['stairs', 'elevator', 'escalator', 'toilet', 'exit']);

// --- 表示の切り替え ---
let mode = 'exterior';

function flyTo(target, distance, polar = 0.9, azimuth = -0.35) {
  controls.target.copy(target);
  const off = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)).multiplyScalar(distance);
  camera.position.copy(target).add(off);
  controls.update();
}

function setMode(next, floor) {
  mode = next;
  const isExt = mode === 'exterior';
  exterior.visible = isExt;
  scene.background = isExt ? SKY : INDOOR_BG;
  scene.fog = isExt ? new THREE.Fog(SKY, 18000, 60000) : null;
  for (const [id, t] of indoor) t.view.group.visible = id === mode;
  hideInfo();
  if (!isExt) {
    const t = indoor.get(mode);
    if (floor != null && t.view.floors.has(floor)) t.floor = floor;
    if (t.floor === 0) t.floor = 1;
    t.view.showFloor(t.floor);
    t.view.setBadgeFilter(badgeKeys);
  }
  overview();
  renderNav();
  renderFloors();
  renderSide();
  const hash = isExt ? '' : `#${mode}/${indoor.get(mode).floor}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
}

/** 最初の視点に戻す (外観は空港全体、屋内は表示中の階の全体) */
function overview() {
  if (mode === 'exterior') {
    controls.minDistance = 300;
    controls.maxDistance = 40000;
    flyTo(toVec(400, -1500, 40), 11000, 0.85, -0.3);
    return;
  }
  const t = indoor.get(mode);
  const bb = t.view.floors.get(t.floor).bbox;
  const c = { x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2 };
  const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 150);
  controls.minDistance = 20;
  controls.maxDistance = 4000;
  flyTo(toVec(c.x, c.y, floorBase(t.floor)), size * 1.25, 0.75, -0.3);
}

// --- 画面の部品 ---
function renderNav() {
  const nav = $('views');
  nav.replaceChildren();
  const add = (id, text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-pressed', String(mode === id));
    b.onclick = () => setMode(id);
    nav.appendChild(b);
  };
  add('exterior', '外観');
  for (const t of terminals) add(t.id, t.name);
}

function renderFloors() {
  const box = $('floors');
  if (mode === 'exterior') { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren();
  const t = indoor.get(mode);
  const h = document.createElement('h2');
  h.textContent = 'フロア';
  box.appendChild(h);
  // 上の階から並べる。1階屋外 (0) は 1階と一緒に表示する
  const list = t.data.floors.filter((f) => f.ordinal !== 0).sort((a, b) => b.ordinal - a.ordinal);
  for (const f of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = f.label;
    b.title = f.name;
    b.setAttribute('aria-pressed', String(t.floor === f.ordinal));
    b.onclick = () => {
      t.floor = f.ordinal;
      t.view.showFloor(f.ordinal);
      // 高さだけ合わせて、見ている向き・距離はそのまま
      const dy = floorBase(f.ordinal) - controls.target.y;
      controls.target.y += dy;
      camera.position.y += dy;
      hideInfo();
      renderFloors();
      history.replaceState(null, '', `#${mode}/${f.ordinal}`);
    };
    box.appendChild(b);
  }
}

let sideOpen = window.innerWidth > 640; // スマホでは最初は畳んでおく
function renderSide() {
  const panel = $('side');
  const side = document.createElement('details');
  side.open = sideOpen;
  side.ontoggle = () => { sideOpen = side.open; };
  // 「全体を見る」は凡例を畳んでいても押せるように外に置く
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.id = 'btn-overview';
  reset.textContent = '全体を見る';
  reset.onclick = overview;
  panel.replaceChildren(reset, side);
  const h = document.createElement('summary');
  side.appendChild(h);
  if (mode === 'exterior') {
    h.textContent = '外観';
    const ex = document.createElement('label');
    ex.textContent = '高低差の強調';
    const sel = document.createElement('select');
    for (const k of [1, 2, 3, 5]) {
      const o = document.createElement('option');
      o.value = k; o.textContent = `${k}倍`; o.selected = k === exaggeration;
      sel.appendChild(o);
    }
    sel.onchange = () => { exaggeration = Number(sel.value); placeExterior(); };
    ex.appendChild(sel);
    const pl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = planesOn;
    cb.onchange = () => { planesOn = cb.checked; };
    pl.append(cb, '飛行機の離着陸（模擬）');
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'ドラッグで回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）でズーム。ターミナルをクリックすると屋内を表示します。';
    side.append(ex, pl, p);
    return;
  }
  h.textContent = '凡例';
  const ul = document.createElement('ul');
  const toggleable = { stairs: 1, elevator: 1, escalator: 1, toilet: 1 };
  for (const g of GROUPS) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = g.color;
    if (toggleable[g.key]) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = badgeKeys.has(g.key);
      cb.title = 'アイコンを表示';
      cb.onchange = () => { cb.checked ? badgeKeys.add(g.key) : badgeKeys.delete(g.key); indoor.get(mode).view.setBadgeFilter(badgeKeys); };
      lab.append(cb, sw, g.name);
      li.appendChild(lab);
    } else {
      li.append(sw, g.name);
    }
    ul.appendChild(li);
  }
  const floorLi = document.createElement('li');
  const floorSw = document.createElement('span');
  floorSw.className = 'swatch';
  floorSw.style.background = '#c8ccd2';
  floorLi.append(floorSw, '区画のない部分（非公開など）');
  ul.appendChild(floorLi);
  const li = document.createElement('li');
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = badgeKeys.has('exit');
  cb.onchange = () => { cb.checked ? badgeKeys.add('exit') : badgeKeys.delete('exit'); indoor.get(mode).view.setBadgeFilter(badgeKeys); };
  lab.append(cb, '出入口の名前');
  li.appendChild(lab);
  ul.appendChild(li);
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = 'ドラッグで回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）でズーム。チェックで階段・エレベーター・エスカレーター・トイレのアイコンを表示します。区画をクリックすると種類を表示します。店名はデータに含まれていません（2021年3月時点のデータ）。';
  side.append(ul, p);
}

function showInfo(d) {
  const box = $('info');
  box.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = d.title;
  box.appendChild(h);
  for (const s of d.sub) {
    const p = document.createElement('p');
    p.textContent = s;
    box.appendChild(p);
  }
  box.hidden = false;
}
function hideInfo() { $('info').hidden = true; }

// --- クリック ---
const ray = new THREE.Raycaster();
// クリック (タップ) とみなすのは、動きが 6px 未満で 0.5 秒未満のとき (山梨・横浜と同じ)
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || !e.isPrimary) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 500;
  down = null;
  if (moved >= 6 || !quick) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  if (mode === 'exterior') {
    const hit = ray.intersectObjects(massing.map((m) => m.mesh))[0];
    if (hit) setMode(hit.object.userData.id);
    return;
  }
  const hit = ray.intersectObjects(indoor.get(mode).view.pickables())[0];
  const d = hit && describe(hit.object.userData);
  d ? showInfo(d) : hideInfo();
});

// --- 開始 ---
function fromHash() {
  const m = location.hash.match(/^#(T[123])(?:\/(-?\d+))?$/);
  if (m && indoor.has(m[1])) setMode(m[1], m[2] != null ? Number(m[2]) : undefined);
  else setMode('exterior');
}
window.addEventListener('hashchange', fromHash);
fromHash();
$('loading').hidden = true;

$('credit-toggle').onclick = () => { $('credit-body').hidden = !$('credit-body').hidden; };

const timer = new THREE.Timer();
if (import.meta.env.DEV) window.__map = { camera, controls, traffic, toVec };

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());
  if (mode === 'exterior') traffic.update(dt, ground, planesOn);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
