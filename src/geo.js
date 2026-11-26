// 経緯度 (JGD2011) とシーン座標 (メートル) の変換。scripts と画面の両方で使う。
// 原点付近の平面近似 (正距円筒)。範囲は 10 km 程度なので誤差は地図表示に影響しない。
export const ORIGIN = { lat: 35.775, lon: 140.38 };
const R = 6378137;
const K = Math.PI / 180;
const COS0 = Math.cos(ORIGIN.lat * K);

/** 経緯度 → { x: 東向き m, y: 北向き m } */
export function project(lon, lat) {
  return { x: (lon - ORIGIN.lon) * K * R * COS0, y: (lat - ORIGIN.lat) * K * R };
}

/** { x, y } (m) → [lon, lat] */
export function unproject(x, y) {
  return [ORIGIN.lon + x / (K * R * COS0), ORIGIN.lat + y / (K * R)];
}
