import * as THREE from 'three';
import { RUNWAYS, along } from './runways.js';
import { toVec } from './terrain.js';

// 時刻表を使わない模擬の離着陸。どちらの滑走路も北向き (34L / 34R) で運用し、
// 着陸と離陸を一定の間隔で繰り返す。
const SIM_SPEED = 3; // 実際の何倍の速さで動かすか
const SCALE = 3; // 見やすいように飛行機を大きく描く倍率
const CYCLE = 200; // 1 本の滑走路で着陸 + 離陸を繰り返す周期 (模擬の秒)
const OFFSETS = { A: 0, B: 70 };
const DEG = Math.PI / 180;

function planeModel(color) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  const tint = new THREE.MeshLambertMaterial({ color });
  const grey = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
  // 前が +z、上が +y
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 50, 12), white);
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 25;
  nose.scale.y = 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(2.8, 9, 12), white);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -29.5;
  const wingShape = new THREE.Shape([new THREE.Vector2(0, 6), new THREE.Vector2(30, -8), new THREE.Vector2(30, -12), new THREE.Vector2(0, -6)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.8, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  const wingR = new THREE.Mesh(wingGeo, white);
  const wingL = new THREE.Mesh(wingGeo, white);
  wingL.scale.x = -1;
  for (const w of [wingR, wingL]) w.position.set(0, -1, 2);
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-8, 11), new THREE.Vector2(-12, 11), new THREE.Vector2(-10, 0)]);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.6, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  const fin = new THREE.Mesh(finGeo, tint);
  fin.position.set(0.3, 2, -20);
  const stabShape = new THREE.Shape([new THREE.Vector2(0, 2), new THREE.Vector2(10, -3), new THREE.Vector2(10, -6), new THREE.Vector2(0, -4)]);
  const stabGeo = new THREE.ExtrudeGeometry(stabShape, { depth: 0.5, bevelEnabled: false });
  stabGeo.rotateX(Math.PI / 2);
  const stabR = new THREE.Mesh(stabGeo, white), stabL = new THREE.Mesh(stabGeo, white);
  stabL.scale.x = -1;
  for (const s of [stabR, stabL]) s.position.set(0, 1, -26);
  const engGeo = new THREE.CylinderGeometry(1.6, 1.6, 6, 10);
  engGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(engGeo, grey);
    e.position.set(side * 10, -2.6, 4);
    g.add(e);
  }
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 2.85, 40, 12, 1, true, Math.PI * 0.35, Math.PI * 0.3), tint);
  stripe.rotation.x = Math.PI / 2;
  // 機内から見るときは胴体を隠し、翼とエンジンだけ見えるようにする
  for (const m of [body, nose, tail, stripe, fin]) m.userData.hull = true;
  g.add(body, nose, tail, wingR, wingL, fin, stabR, stabL, stripe);
  g.scale.setScalar(SCALE);
  g.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return g;
}

const COLORS = [0x1d4ed8, 0xdc2626, 0x0f766e, 0x7c3aed, 0xea580c, 0x0369a1];

/** 1 回の飛行の、経過時間 τ (模擬の秒) における状態。null なら終わり */
function landingState(r, tau, ground) {
  const V = 72, TD = 400, D = 13000, GS = 3 * DEG;
  const tApproach = (D + TD) / V;
  let t, alt, pitch, fade = 1;
  if (tau < tApproach) {
    t = -D + V * tau;
    alt = (TD - t) * Math.tan(GS);
    pitch = 3 * DEG;
    fade = Math.min(1, tau / 6);
  } else {
    const s = tau - tApproach, a = 2.2, Vx = 18;
    const tStop = (V - Vx) / a;
    t = TD + (s < tStop ? V * s - (a * s * s) / 2 : V * tStop - (a * tStop * tStop) / 2 + Vx * (s - tStop));
    alt = 0;
    pitch = s < 4 ? 3 * DEG * (1 - s / 4) : 0;
    if (s > tStop + 8) fade = 1 - (s - tStop - 8) / 6;
    if (fade <= 0) return null;
  }
  const p = along(r, t, ground);
  const phase = tau < tApproach ? '着陸のため降下中' : '着陸して減速中';
  return { x: p.x, y: p.y, h: p.h + alt + 3.5 * SCALE, alt, pitch, fade, phase };
}

function takeoffState(r, tau, ground) {
  const a = 2.0, VR = 80, T0 = 150;
  const tRot = VR / a;
  const dRot = (a * tRot * tRot) / 2;
  let t, alt, pitch, fade = Math.min(1, tau / 3);
  if (tau < tRot) {
    t = T0 + (a * tau * tau) / 2;
    alt = 0;
    pitch = 0;
  } else {
    // 浮き上がってから 8 度で上昇し、100 m/s まで加速する
    const s = tau - tRot, sMax = (100 - VR) / 0.6;
    const d = s < sMax ? VR * s + 0.3 * s * s : VR * sMax + 0.3 * sMax * sMax + 100 * (s - sMax);
    t = T0 + dRot + d;
    alt = Math.max(0, d - 200) * Math.tan(8 * DEG) * Math.min(1, s / 10);
    pitch = Math.min(12 * DEG, (s / 4) * 12 * DEG);
    if (t > r.len + 13000) return null;
    fade = Math.min(1, (r.len + 13000 - t) / 2000);
  }
  const p = along(r, t, ground);
  const phase = tau < tRot ? '離陸のため加速中' : '上昇中';
  return { x: p.x, y: p.y, h: p.h + alt + 3.5 * SCALE, alt, pitch, fade, phase };
}

const stateOf = (f, tau, ground) => (f.kind === 'land' ? landingState(f.r, tau, ground) : takeoffState(f.r, tau, ground));

// 乗ったときのカメラの位置 (飛行機のモデルの座標。前が +z、左が +x) と、最初に見る向き (左が正の度)
export const SEATS = {
  cockpit: { name: '操縦席', pos: [0, 1.3, 26], yaw: 0, pitch: -4 },
  window: { name: '客席の窓（左側）', pos: [3.1, 0.8, -14], yaw: 70, pitch: -14 }, // 翼の後ろの席
};

export function createTraffic(scene) {
  const flights = [];
  let simTime = 0;
  let colorIndex = 0;
  const lastSpawn = new Map();

  function spawn(kind, r) {
    const obj = planeModel(COLORS[colorIndex++ % COLORS.length]);
    scene.add(obj);
    flights.push({ kind, r, start: simTime, obj });
  }

  function setOpacity(obj, a) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material.transparent = a < 1;
      o.material.opacity = a;
    });
  }

  const fwd = new THREE.Vector3();
  function update(dt, ground, visible) {
    simTime += dt * SIM_SPEED;
    // 周期ごとに着陸と離陸を始める
    for (const r of RUNWAYS) {
      const phase = simTime - OFFSETS[r.key];
      if (phase < 0) continue;
      const k = Math.floor(phase / CYCLE);
      const key = `${r.key}`;
      const last = lastSpawn.get(key) ?? { land: -1, take: -1 };
      if (last.land < k) { last.land = k; spawn('land', r); }
      if (last.take < k && phase % CYCLE > CYCLE / 2) { last.take = k; spawn('take', r); }
      lastSpawn.set(key, last);
    }
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const tau = simTime - f.start;
      const st = stateOf(f, tau, ground);
      if (!st) {
        f.ended = true;
        scene.remove(f.obj);
        f.obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        flights.splice(i, 1);
        continue;
      }
      f.obj.visible = visible;
      const pos = toVec(st.x, st.y, st.h);
      // 速さ (実際の速さに直したもの、m/s)
      if (f.last && dt > 0) f.speed = pos.distanceTo(f.last) / (dt * SIM_SPEED);
      f.last = pos.clone();
      f.state = st;
      f.obj.position.copy(pos);
      fwd.copy(toVec(f.r.u.x, f.r.u.y, 0)).normalize();
      fwd.y = Math.tan(st.pitch);
      f.obj.lookAt(f.obj.position.clone().add(fwd));
      setOpacity(f.obj, Math.max(0, Math.min(1, st.fade)));
    }
  }

  // 最初から空港が賑やかに見えるように、少し先まで進めておく
  function warmUp(ground) {
    for (let k = 0; k < 120; k++) update(1, ground, true);
  }
  /** 飛行の残り時間 (画面の上の秒)。乗る飛行機を選ぶのに使う */
  /** 始まってからの時間 (模擬の秒) */
  const elapsed = (f) => simTime - f.start;
  function remaining(f, ground) {
    let tau = simTime - f.start, k = 0;
    while (stateOf(f, tau, ground) && k < 2000) { tau += 1; k++; }
    return k / SIM_SPEED;
  }
  return { update, warmUp, flights, remaining, elapsed };
}
