// Shapefile (.shp / .dbf) の最小限の読み込み。点・線・面 (タイプ 1, 3, 5) に対応する。
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sjis = new TextDecoder('shift_jis');

/** .shp を読み、図形ごとに部品 (点の配列) の配列を返す。点は [lon, lat]。 */
export function readShp(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const shapes = [];
  let o = 100;
  while (o + 8 <= buf.byteLength) {
    const len = dv.getInt32(o + 4, false) * 2; // 16bit 語単位
    const r = o + 8;
    const type = dv.getInt32(r, true);
    if (type === 0) {
      shapes.push(null);
    } else if (type === 1) {
      shapes.push([[[dv.getFloat64(r + 4, true), dv.getFloat64(r + 12, true)]]]);
    } else if (type === 3 || type === 5) {
      const nParts = dv.getInt32(r + 36, true);
      const nPoints = dv.getInt32(r + 40, true);
      const starts = [];
      for (let i = 0; i < nParts; i++) starts.push(dv.getInt32(r + 44 + i * 4, true));
      starts.push(nPoints);
      const p0 = r + 44 + nParts * 4;
      const parts = [];
      for (let i = 0; i < nParts; i++) {
        const pts = [];
        for (let j = starts[i]; j < starts[i + 1]; j++) {
          pts.push([dv.getFloat64(p0 + j * 16, true), dv.getFloat64(p0 + j * 16 + 8, true)]);
        }
        parts.push(pts);
      }
      shapes.push(parts);
    } else {
      throw new Error(`未対応の図形タイプ ${type}`);
    }
    o = r + len;
  }
  return shapes;
}

/** .dbf を読み、レコード (オブジェクト) の配列を返す。文字コードは UTF-8、だめなら CP932。 */
export function readDbf(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recLen = dv.getUint16(10, true);
  const fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    const name = String.fromCharCode(...buf.subarray(o, o + 11)).replace(/\0.*$/s, '');
    fields.push({ name, len: buf[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    const rec = buf.subarray(headerLen + i * recLen, headerLen + (i + 1) * recLen);
    const row = {};
    let p = 1;
    for (const f of fields) {
      const bytes = rec.subarray(p, p + f.len);
      p += f.len;
      let s;
      try {
        s = utf8.decode(bytes);
      } catch {
        s = sjis.decode(bytes);
      }
      row[f.name] = s.replace(/\0/g, '').trim();
    }
    rows.push(row);
  }
  return rows;
}
