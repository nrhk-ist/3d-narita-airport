import * as THREE from 'three';

// シーン座標: x = 東 (m), y = 上 (m), z = 南 (m)。地図の北 (y) は -z になる。
export const toVec = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

export async function loadTerrain(base) {
  const [meta, bin] = await Promise.all([
    fetch(`${base}data/terrain.json`).then((r) => r.json()),
    fetch(`${base}data/terrain.bin`).then((r) => r.arrayBuffer()),
  ]);
  const heights = new Int16Array(bin);
  const { nx, ny, extent: e, scale } = meta;
  /** 標高 (m, 強調なし)。範囲外は端の値 */
  const sample = (x, y) => {
    const fi = Math.min(nx - 1, Math.max(0, ((x - e.west) / (e.east - e.west)) * (nx - 1)));
    const fj = Math.min(ny - 1, Math.max(0, ((e.north - y) / (e.north - e.south)) * (ny - 1)));
    const i = Math.min(nx - 2, Math.floor(fi)), j = Math.min(ny - 2, Math.floor(fj));
    const tx = fi - i, ty = fj - j;
    const h = (a, b) => heights[b * nx + a] * scale;
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - ty) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * ty;
  };
  return { meta, heights, sample };
}

export function buildTerrainMesh(terrain, texture) {
  const { nx, ny, extent: e } = terrain.meta;
  const geo = new THREE.PlaneGeometry(e.east - e.west, e.north - e.south, nx - 1, ny - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate((e.east + e.west) / 2, 0, -(e.north + e.south) / 2);
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';

  // 地形の縁を下に伸ばして、厚みのある台のように見せる
  const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x8b7355, side: THREE.DoubleSide }));

  function setExaggeration(k) {
    const pos = geo.attributes.position;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      pos.setY(j * nx + i, terrain.heights[j * nx + i] * terrain.meta.scale * k);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const verts = [];
    const bottom = -60;
    const edge = (list) => {
      for (let n = 0; n < list.length - 1; n++) {
        const a = list[n], b = list[n + 1];
        const pa = [pos.getX(a), pos.getY(a), pos.getZ(a)], pb = [pos.getX(b), pos.getY(b), pos.getZ(b)];
        verts.push(...pa, pa[0], bottom, pa[2], ...pb, ...pb, pa[0], bottom, pa[2], pb[0], bottom, pb[2]);
      }
    };
    const top = [...Array(nx).keys()];
    const bot = top.map((i) => (ny - 1) * nx + i).reverse();
    const left = [...Array(ny).keys()].map((j) => j * nx).reverse();
    const right = [...Array(ny).keys()].map((j) => j * nx + nx - 1);
    edge(top); edge(right); edge(bot); edge(left);
    skirt.geometry.dispose();
    skirt.geometry = new THREE.BufferGeometry();
    skirt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    skirt.geometry.computeVertexNormals();
  }
  const group = new THREE.Group();
  group.add(mesh, skirt);
  return { group, mesh, setExaggeration };
}
