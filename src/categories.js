// 屋内地図の区画 (Space) の種類。コードは製品仕様書による。
// h: 床からの高さ (m)。移動設備は目立つように高くする。
export const GROUPS = [
  { key: 'shop', name: '商業施設', color: '#f59e0b', h: 1.2, codes: ['B001'] },
  { key: 'stairs', name: '階段', color: '#dc2626', h: 3.0, codes: ['B021'], badge: '階段' },
  { key: 'elevator', name: 'エレベーター', color: '#7c3aed', h: 3.0, codes: ['B022'], badge: 'EV' },
  { key: 'escalator', name: 'エスカレーター', color: '#059669', h: 3.0, codes: ['B023'], badge: 'ES' },
  { key: 'walkway', name: '動く歩道・スロープ', color: '#0891b2', h: 0.6, codes: ['B024', 'B025'] },
  { key: 'toilet', name: 'トイレ', color: '#60a5fa', h: 1.2, codes: ['B007', 'B008', 'B009', 'B010', 'B011', 'B012', 'B013', 'B014'], badge: 'WC' },
  { key: 'service', name: '案内・待合・授乳室など', color: '#a3e635', h: 1.2, codes: ['B003', 'B004', 'B005', 'B006', 'B015', 'B016', 'B017'] },
  { key: 'room', name: 'その他の部屋', color: '#94a3b8', h: 1.2, codes: ['B002', 'B018', 'B019', 'B026', 'B027', 'B028'] },
  { key: 'concourse', name: '通路・コンコース', color: '#fafaf9', h: 0.05, codes: ['B029', 'B030', 'B031'] },
  { key: 'void', name: '吹抜', color: '#475569', h: 0.02, codes: ['B020'], opacity: 0.35 },
];

export const SPACE_NAMES = {
  B001: '商業施設', B002: '事務所', B003: '公的施設', B004: '待合室・休憩所', B005: 'きっぷ売り場', B006: '受付・案内',
  B007: 'トイレ（男性用）', B008: 'トイレ（女性用）', B009: 'トイレ（男女共用）', B010: 'トイレ（男女不明）',
  B011: '多機能トイレ', B012: '多機能トイレ（オストメイト対応）', B013: '多機能トイレ（おむつ交換シート）', B014: '多機能トイレ（オストメイト・おむつ交換シート）',
  B015: '喫煙場所', B016: '授乳室', B017: '救護室', B018: '駅事務室', B019: 'その他の部屋', B020: '吹抜',
  B021: '階段', B022: 'エレベーター', B023: 'エスカレーター', B024: '動く歩道', B025: 'スロープ', B026: '非公開の区画',
  B027: '駐車場', B028: 'プラットホーム', B029: '通路・コンコース', B030: 'ペデストリアンデッキ', B031: '歩道橋',
};

const byCode = new Map();
for (const g of GROUPS) for (const c of g.codes) byCode.set(c, g);
export const groupOf = (code) => byCode.get(code) ?? GROUPS.find((g) => g.key === 'room');
