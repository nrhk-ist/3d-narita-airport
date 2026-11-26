import * as THREE from 'three';
import { SEATS } from './planes.js';

// 飛行機に乗って見る。操作は山梨の3Dマップの「電車に乗る」と同じ:
//   ドラッグ (1本指) で見回す、ホイール (ピンチ) で望遠・広角、ダブルクリック (ダブルタップ) で正面に戻す、Esc で降りる
const FOV_DEFAULT = 60, FOV_MIN = 15, FOV_MAX = 90;
const HINT = 'ドラッグで見回す・ホイールでズーム・ダブルクリックで正面・Esc で降りる';

export function createRide({ camera, canvas, onExit }) {
  let flight = null;
  let seat = 'cockpit';
  const look = { yaw: 0, pitch: 0, fov: FOV_DEFAULT };
  let saved = null;

  const offset = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // カメラは -z を向くので反転
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const lookQ = new THREE.Quaternion();

  function setHull(visible) {
    flight?.obj.traverse((o) => { if (o.userData.hull) o.visible = visible; });
  }
  function resetLook() {
    look.yaw = SEATS[seat].yaw;
    look.pitch = SEATS[seat].pitch;
  }

  function enter(f, cam) {
    if (flight) setHull(true);
    if (!flight) saved = cam;
    flight = f;
    setHull(false);
    look.fov = FOV_DEFAULT;
    resetLook();
  }
  function setSeat(s) {
    seat = s;
    resetLook();
  }
  function exit() {
    if (!flight) return;
    if (!flight.ended) setHull(true);
    flight = null;
    camera.fov = 45;
    camera.updateProjectionMatrix();
    onExit(saved);
  }

  /** 毎フレーム、乗っている飛行機に合わせてカメラを動かす */
  function update() {
    if (!flight) return;
    if (flight.ended) { exit(); return; }
    const o = flight.obj;
    o.updateMatrixWorld();
    offset.fromArray(SEATS[seat].pos);
    camera.position.copy(o.localToWorld(offset.clone()));
    o.getWorldQuaternion(q);
    euler.set(THREE.MathUtils.degToRad(look.pitch), THREE.MathUtils.degToRad(look.yaw), 0, 'YXZ');
    lookQ.setFromEuler(euler);
    camera.quaternion.copy(q).multiply(turn).multiply(lookQ);
    if (camera.fov !== look.fov) {
      camera.fov = look.fov;
      camera.updateProjectionMatrix();
    }
  }

  // --- 操作 ---
  const pointers = new Map();
  let pinchDist = 0;
  let lastTap = null;
  const setFov = (v) => { look.fov = THREE.MathUtils.clamp(v, FOV_MIN, FOV_MAX); };
  canvas.addEventListener('pointerdown', (e) => {
    if (!flight) return;
    // ダブルタップ (タッチ) で正面に戻す。マウスは dblclick で扱う
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        resetLook();
        lastTap = null;
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!flight || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      // 画面の高さ 1 枚分のドラッグで、視野角と同じ角度だけ回る (つかんで動かす感覚)
      const degPerPx = look.fov / canvas.clientHeight;
      look.yaw = ((look.yaw + (cur.x - prev.x) * degPerPx + 540) % 360) - 180;
      look.pitch = THREE.MathUtils.clamp(look.pitch + (cur.y - prev.y) * degPerPx, -80, 80);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) setFov(look.fov * (pinchDist / d));
      pinchDist = d;
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('dblclick', () => { if (flight) resetLook(); });
  // ホイール: ズーム (望遠・広角)。Ctrl+ホイール (タッチパッドのピンチ) もズーム
  canvas.addEventListener('wheel', (e) => {
    if (!flight) return;
    e.preventDefault();
    setFov(look.fov * Math.exp((e.deltaY || e.deltaX) * (e.ctrlKey ? 0.01 : 0.001)));
  }, { passive: false });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') exit(); });

  return {
    enter, exit, update, setSeat,
    get active() { return flight != null; },
    get flight() { return flight; },
    get seat() { return seat; },
    HINT,
  };
}
