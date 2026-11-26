# 3d-narita-airport

成田国際空港の3Dマップ。外観（滑走路・周りの地形・飛行機の離着陸）と、第1〜第3ターミナルの各フロアを切り替えて見られます。

公開ページ: https://nrhk-ist.github.io/3d-narita-airport/

## できること

- **外観**: 国土地理院の標高と空中写真で、空港と周りの土地の高低差を表示します（強調の倍率を選べます）。A滑走路・B滑走路では、時刻表によらない模擬の離着陸アニメーションが動きます。
- **各フロア**: ターミナルと階を選ぶと、区画を種類ごとに色分けして表示します。階段・エレベーター・エスカレーター・トイレはアイコンでも示します。区画をクリックすると種類が出ます。
- **操作**（山梨・横浜の3Dマップと共通）: ドラッグ（1本指）で回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）でズーム、クリック（タップ）で選ぶ。「全体を見る」で最初の視点に戻ります。
- URL の `#T1/4`（第1ターミナル 4階）のような指定で、そのフロアを直接開けます。

### 制約

- 屋内地図は2021年3月時点のデータです。その後の改装は反映されていません。
- 店名はデータに含まれないため表示していません（店舗の区画は「商業施設」として色分け）。
- 建物の高さは1階あたり6mとした目安です。飛行機は見やすいように大きく描いています。

## ファイル構成

| パス | 内容 |
| --- | --- |
| `data/source/` | 元データ（ダウンロードしたまま、変更しない） |
| `scripts/build-indoor.mjs` | 屋内地図の Shapefile から `public/data/indoor/*.json` を作る |
| `scripts/build-terrain.mjs` | 国土地理院のタイルから `public/data/terrain.*`・`photo.jpg` を作る |
| `public/data/` | 画面で読み込むデータ（上のスクリプトで作ったもの） |
| `src/` | 画面（three.js） |
| `.github/workflows/deploy.yml` | main への push で GitHub Pages に公開。公開のたびにデータを作り直す |

## 開発

```sh
npm ci
npm run data   # データを作り直す（地形は国土地理院のタイルを取得するのでネットワークが必要）
npm run dev    # http://localhost:5173/
npm run build  # dist/ に出力
```

## 出典

- 屋内地図: 出典：国土交通省高精度測位社会プロジェクト
  「成田国際空港屋内地図データ」（国土交通省）（https://www.geospatial.jp/ckan/dataset/mlit-indoor-narita-airport-r2）を加工して作成
  詳しくは [data/source/mlit-indoor-narita-airport-r2/README.md](data/source/mlit-indoor-narita-airport-r2/README.md)
- 地形・空中写真: [国土地理院](https://maps.gsi.go.jp/development/ichiran.html)（標高タイル、シームレス空中写真）を加工して作成
- 滑走路の位置: 国土地理院のシームレス空中写真から読み取りました（`src/runways.js`）。

この地図は個人が作成したもので、国や成田国際空港株式会社が作成・公開しているものではありません。
