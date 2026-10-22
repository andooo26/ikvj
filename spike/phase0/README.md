# Phase 0：GPU 経路の技術検証

検証したいのは、次の経路が **CPU を通さずに** 1080p60 で回るかどうか。

```
offscreen BrowserWindow (useSharedTexture)
  └─ paint → engine.setSource(slot)        ← IOSurface / NT handle を直接受け取る
engine.compose(layers)                     ← Metal / D3D11 でレイヤーを合成
  └─ Syphon / Spout: ikvj-A..D, ikvj-MIX
engine.sharedHandle(MIX) → sharedTexture → コントロール画面のプレビュー
```

負荷はわざと最悪のケースにしている：YouTube 2 本（A, B）と汎用のスタンドイン 2 本（C, D）、出力 5 系統すべて ON。

## 結果

| 項目 | macOS（Apple M5） | Windows |
|---|---|---|
| native のセルフテスト（`npm run test:native`） | ✅ PASS | 未実施 |
| 4 ソースの取り込み | ✅ 4 本とも 60fps | 未実施 |
| `setSource`（1 フレーム） | 0.2〜0.3ms（非同期化後） | 未実施 |
| 合成＋5 系統の送出 | 0.11〜0.2ms、MIX は 58〜59fps | 未実施 |
| 受信側から見た上下の向き | ✅ 左上が左上（VDMX などと同じ OpenGL の Syphon クライアントで読み取って確認） | 未実施 |
| 受信クライアントの検出 | ✅ `hasClients` = true | Spout は検出できない |
| ゼロコピーのプレビュー | ✅ 29fps、失敗 0 回 | 未実施 |
| **CPU 使用率（全プロセス合計）** | **約 8%** | 未実施 |

### わかった課題
- ~~`setSource` が GPU の読み終わりを待ってからテクスチャを返していて、メインスレッドが 1 秒あたり約 0.3 秒ブロックされる~~
  → **対応済み**。`setSource` はすぐ戻り、GPU が読み終えたものを `completed()` で受け取ってから `release()` する方式にした。1 回あたり 1〜1.7ms → 0.2〜0.3ms。
- Syphon.framework は暫定でビルド済みのものを使っている（`vendor/syphon/README.md` を参照）。

## Windows での検証手順

### 事前に必要なもの
- Node.js 24 LTS
- Visual Studio 2022 Build Tools の「C++ によるデスクトップ開発」ワークロード（MSVC と Windows SDK）
- Python 3（node-gyp が使う）
- Spout の受信ソフト（Resolume、TouchDesigner、Spout 付属の `SpoutReceiver.exe` のどれか）

> Build Tools が必要なのは Phase 0 の間だけ。リリース版ではビルド済みのバイナリを同梱する。

### 実行
```powershell
npm install
npm run build:native     # 初めての Windows ビルド。エラーが出たらログを全部送ってください
npm run test:native      # 最後に SELFTEST_PASS が出ること
npm run phase0           # コントロール画面が開き、1 秒ごとに [phase0] {...} が出る
```

30 秒だけ動かしてスクリーンショットを残す場合：
```powershell
npm run phase0 -- --seconds=30 --opacity=1,0,0.4,0 --snapshot=phase0.png
```

### 確認してほしいこと
1. `[phase0] engine d3d11 on "..."` の **GPU 名**（ノート PC で GPU が 2 枚ある機種かどうかも）
2. `[phase0] {...}` の行で、次の値：
   - `fps` が A〜D すべて 60 前後か
   - `errors` が空か（`OpenSharedResource1 failed` が出ていたら、下の「既知のリスク」を参照）
   - `cpu.total`
3. 受信ソフトに **`ikvj-A`〜`D` と `ikvj-MIX`** が出てくるか。C を受信したとき、**赤い `TOP-LEFT` が左上に来ているか**
4. コントロール画面の MIX プレビューが動いているか（`preview.fail` が 0 か）
5. フェーダーと「Reverse layer order」に、MIX の受信映像が反応するか

### 既知のリスク
- **GPU が 2 枚あるノート PC**：Chromium と ikvj が別々の GPU でデバイスを作ると、`OpenSharedResource1` が失敗する。その場合は、Chromium 側のアダプター LUID を合わせる処理を追加する。
- **D3D11 のコードは Mac では一度もコンパイルできていない**。最初のビルドでエラーが出る前提で考えている。
