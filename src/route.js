import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { floorBase } from './indoor.js';

// 屋内の経路案内。歩行ネットワーク (public/data/indoor/network.json) の上で最短の道順を探す。
const TYPE = { WALK: 1, MOVING: 2, ELEVATOR: 4, ESCALATOR: 5, STAIRS: 6, SLOPE: 7 };
const VERTICAL_NAME = { [TYPE.ELEVATOR]: 'エレベーター', [TYPE.ESCALATOR]: 'エスカレーター', [TYPE.STAIRS]: '階段' };
const WALK_SPEED = 75; // m/分 (空港内を荷物を持って歩く目安)
const ELEVATOR_WAIT = 0.75; // 分 (エレベーターを待つ時間の目安)

export async function loadNetwork(base) {
  const { nodes, links } = await fetch(`${base}data/indoor/network.json`).then((r) => r.json());
  const n = nodes.length / 3;
  const node = (i) => ({ x: nodes[i * 3] / 10, y: nodes[i * 3 + 1] / 10, ord: nodes[i * 3 + 2] });
  const adj = Array.from({ length: n }, () => []);
  links.forEach(([a, b, type, dir, dist, pts], id) => {
    const len = Math.max(0.5, dist / 10);
    adj[a].push({ to: b, type, len, id, forward: true });
    if (dir === 1) adj[b].push({ to: a, type, len, id, forward: false });
  });
  return { n, node, adj, links };
}

/** 指定の階で (x, y) に一番近いノード。maxDist (m) より遠ければ null */
export function nearestNode(net, x, y, ord, maxDist = 40) {
  let best = null, bd = maxDist;
  for (let i = 0; i < net.n; i++) {
    const p = net.node(i);
    if (p.ord !== ord) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * 最短経路 (ダイクストラ法)。goals は目的地の候補のノードの集合で、一番近いものに着く。
 * barrierFree なら階段とエスカレーターを使わない。
 */
export function findRoute(net, start, goals, { barrierFree = false } = {}) {
  const goalSet = new Set(goals);
  const dist = new Float64Array(net.n).fill(Infinity);
  const prev = new Array(net.n).fill(null);
  dist[start] = 0;
  // 小さな二分ヒープ
  const heap = [[0, start]];
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let reached = null;
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (goalSet.has(u)) { reached = u; break; }
    for (const e of net.adj[u]) {
      if (barrierFree && (e.type === TYPE.STAIRS || e.type === TYPE.ESCALATOR)) continue;
      // エレベーターは待ち時間の分だけ遠いものとして扱う
      const cost = e.len + (e.type === TYPE.ELEVATOR ? ELEVATOR_WAIT * WALK_SPEED : 0);
      if (d + cost < dist[e.to]) {
        dist[e.to] = d + cost;
        prev[e.to] = { from: u, edge: e };
        push([dist[e.to], e.to]);
      }
    }
  }
  if (reached == null) return null;
  const edges = [];
  for (let v = reached; prev[v]; v = prev[v].from) edges.unshift({ from: prev[v].from, to: v, ...prev[v].edge });
  return { start, goal: reached, edges };
}

/** 経路を「◯階を ◯m 歩く」「エスカレーターで ◯階へ」のような手順にまとめる */
export function describeRoute(net, route, floorLabel) {
  const steps = [];
  let walk = null;
  let meters = 0, minutes = 0;
  const flush = () => {
    if (walk && walk.len > 0.5) steps.push({ kind: 'walk', ord: walk.ord, text: `${floorLabel(walk.ord)}を約 ${Math.round(walk.len)} m 歩く` });
    walk = null;
  };
  for (let i = 0; i < route.edges.length; i++) {
    const e = route.edges[i];
    const a = net.node(e.from), b = net.node(e.to);
    if (a.ord === b.ord) {
      if (!walk) walk = { ord: a.ord, len: 0 };
      walk.len += e.len;
      meters += e.len;
      minutes += e.len / WALK_SPEED;
      continue;
    }
    // 階をまたぐ移動。同じ設備で続けて上り下りするものはまとめる
    flush();
    let j = i, to = b.ord;
    while (j + 1 < route.edges.length) {
      const f = route.edges[j + 1];
      const fa = net.node(f.from), fb = net.node(f.to);
      if (f.type !== e.type || fa.ord === fb.ord) break;
      to = fb.ord;
      j++;
    }
    const name = VERTICAL_NAME[e.type] ?? '通路';
    const up = to > a.ord;
    steps.push({ kind: 'vertical', type: e.type, ord: to, text: `${name}で${floorLabel(to)}へ${up ? '上がる' : '下りる'}` });
    minutes += e.type === TYPE.ELEVATOR ? ELEVATOR_WAIT + 0.3 * Math.abs(to - a.ord) : 0.5 * Math.abs(to - a.ord);
    i = j;
  }
  flush();
  return { steps, meters, minutes };
}

/** 経路の線と、出発・到着の印を作る。現在の階の部分は太く、ほかの階は細く描く */
export function buildRouteView(net, route, currentOrd, resolution) {
  const group = new THREE.Group();
  const at = (p, ord) => new THREE.Vector3(p.x, floorBase(ord) + 1.2, -p.y);
  const segs = { current: [], other: [] };
  for (const e of route.edges) {
    const a = net.node(e.from), b = net.node(e.to);
    const pts = [at(a, a.ord)];
    const mid = net.links[e.id][5];
    const inner = [];
    for (let k = 0; k < mid.length; k += 2) inner.push({ x: mid[k] / 10, y: mid[k + 1] / 10 });
    if (!e.forward) inner.reverse();
    // 階をまたぐ通路は、途中の点を始点の階から終点の階へ少しずつ上げる
    inner.forEach((p, k) => {
      const t = (k + 1) / (inner.length + 1);
      pts.push(new THREE.Vector3(p.x, floorBase(a.ord) + (floorBase(b.ord) - floorBase(a.ord)) * t + 1.2, -p.y));
    });
    pts.push(at(b, b.ord));
    const onCurrent = a.ord === currentOrd || b.ord === currentOrd;
    (onCurrent ? segs.current : segs.other).push(pts);
  }
  const make = (list, color, width, opacity) => {
    for (const pts of list) {
      const g = new LineGeometry();
      g.setPositions(pts.flatMap((v) => [v.x, v.y, v.z]));
      const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: false });
      m.resolution.copy(resolution);
      const line = new Line2(g, m);
      line.renderOrder = 10;
      line.computeLineDistances();
      group.add(line);
    }
  };
  make(segs.other, 0xe11d48, 3, 0.45);
  make(segs.current, 0xe11d48, 7, 1);
  const mark = (i, text, cls) => {
    const p = net.node(i);
    const el = document.createElement('div');
    el.className = `label route-mark ${cls}`;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(at(p, p.ord)).add(new THREE.Vector3(0, 3, 0));
    group.add(o);
  };
  mark(route.start, '出発', 'start');
  mark(route.goal, '到着', 'goal');
  return group;
}

export { TYPE };
