# ikvj 設計方針

[tubetosyphon](https://github.com/andooo26/tubetosyphon) をフルスクラッチで作り直すための設計書。
機能は旧版をすべて引き継ぎ、汎用（ジェネラティブ）出力を YouTube と同格のソースに格上げする。

---

## 1. 決定事項

| 項目 | 決定 |
|---|---|
| アプリ名 | **ikvj** |
| 対応環境 | **macOS arm64（Apple Silicon）** / **Windows x64** |
| ソース | **A, B = YouTube プレイヤー**、**C, D = 汎用（ジェネラティブ）** の 4 つ。画面はこの 2×2 が基本 |
| ミックス | **4ch フェーダー**。通常合成（アルファブレンド）、**重ね順はドラッグで並べ替え可**（初期値は上から D > C > B > A） |
| 自動フェード | チャンネルごとの **Solo**（押したchを 1 に、他を 0 にフェードする）。フェード時間は全体で 1 つ設定 |
| BPM | 全体で 1 つ（Tap / Sync も全体）。ジャンル・Intensity・Tint・seed は C/D それぞれが持つ |
| 出力名 | `ikvj-A` 〜 `ikvj-D`、`ikvj-MIX`（旧名との互換は取らない） |
| 個別出力 | A〜D は **ソースごとに ON/OFF**（初期値 OFF）。`ikvj-MIX` は常に出力 |
| 解像度 / fps | **設定で選べる**（720p / 1080p / 2160p × 30 / 60fps、初期値 1080p60）。全ソースとミックスで共通 |
| 映像パイプライン | **GPU 経路（共有テクスチャ）を Phase 0 で検証**し、続けるか判断する |
| 配布 | **未署名**で GitHub Releases に置く（mac は初回に右クリック→開く、Win は SmartScreen を手動で通す） |
| その他の機能 | プロジェクター出力、Google ログイン（YouTube Premium 用）を引き継ぐ |
| コミット | 作業者（andooo26）が行う |

### 再起動時の復元
`userData/state.json` に保存し、起動時に読み込む（`src/shared/persist.ts`）。
- **復元するもの**：A/B の URL・画質・ミュート、C/D の汎用設定、BPM、フェーダー値・重ね順・フェード時間、個別出力の ON/OFF、解像度と fps、プロジェクターの出力先と表示先ディスプレイ。
- **復元しないもの**：プロジェクターを開いていたかどうか（起動していきなり全画面にならないように）、フェードの途中経過、拍の基準時刻（起動時刻にする）。
- ファイルは項目ごとに検証し、壊れた項目だけを初期値に戻す。書き込みは変更が止まってから 0.5 秒後に、一時ファイル経由の置き換えで行う。

---

## 2. 画面レイアウト

```
┌──────────────────────────────────────────────────────────────────────┐
│ ikvj   ♩ 132.0 [Tap][Sync]   Projector[MIX▼][Display▼][On]  ⚙  ●ログイン │
├───────────────────────────────────┬──────────────────────────────────┤
│ A  YouTube   [出力○] ikvj-A 60fps │ B  YouTube   [出力○] ikvj-B      │
│ [←][検索 / URL________][Play]     │ [←][検索 / URL________][Play]    │
│ ┌───────────────────────────────┐ │ ┌──────────────────────────────┐ │
│ │      プレビュー（クリック可）     │ │ │                              │ │
│ └───────────────────────────────┘ │ └──────────────────────────────┘ │
│ -3 -1 -.5 ▶ +.5 +1 +3 ━━●━━ 1080p │  …                               │
├───────────────────────────────────┼──────────────────────────────────┤
│ C  汎用      [出力○] ikvj-C       │ D  汎用      [出力○] ikvj-D      │
│ ┌───────────────────────────────┐ │ ┌──────────────────────────────┐ │
│ │        ライブプレビュー          │ │ │                              │ │
│ └───────────────────────────────┘ │ └──────────────────────────────┘ │
│ Genre[Techno▼] Int━●━ Tint━●━ [🎲]│ Genre[Kawaii▼] …                 │
├───────────────────────────────────┴──────────────────────────────────┤
│ MIX → ikvj-MIX 60fps   ≡D ┃━━●━┃[S]  ≡C ┃━━━━┃[S]  ≡B ┃━●━━┃[S]  ≡A ┃━━━━┃[S] │
│                        (≡ でドラッグして重ね順を変更 / S = Solo)        │
└──────────────────────────────────────────────────────────────────────┘
```

- 4 つのタイルは共通の枠（ヘッダー・プレビュー・コントロール）を使い、中身だけ YouTube 用と汎用用で差し替える。
- 下段のミキサーは左が最上位レイヤーになるように並べ、画面上の並びと合成順を一致させる。
- プロジェクターの出力元は A〜D または MIX から選ぶ。

---

## 3. アーキテクチャ

### 3.1 データの流れ

```
Source                     Mixer                         Sink
─────────                  ─────                         ────
A  YouTube (offscreen) ─┐                          ┌─→ Syphon / Spout  ikvj-A..D（ON のものだけ）
B  YouTube (offscreen) ─┤  4ch レイヤー合成 (GPU)    ├─→ Syphon / Spout  ikvj-MIX
C  汎用    (offscreen) ─┤  順序・不透明度・Solo      └─→ Projector ウィンドウ
D  汎用    (offscreen) ─┘
```

- **Source** はすべて「出力解像度の GPU テクスチャを毎フレーム出すもの」として扱う。YouTube の映像は Source の中で出力サイズに合わせてレターボックスする。
- **Mixer** は黒背景から始め、下のレイヤーから順に `out = mix(out, src, opacity)` で重ねる。
- **Sink** は `publish(texture)` を実装するだけ。OS による違いは Sink の中に閉じ込める。

### 3.2 プロセスと状態
- 状態を持つのは main プロセスの `store` だけ。UI は store の状態を購読し、操作は「アクション」として main に送る。
- IPC は `src/shared/ipc.ts` に、チャンネル名・引数・戻り値の型と検証をまとめて定義する。main と preload の両方がここから組み立てるので、チャンネル名を文字列で二重に書かない。
- 汎用のスケッチ（`sketch.ts`）は「時刻とパラメータを入れると 1 フレーム描く」純粋関数のまま保つ。出力用の offscreen ウィンドウと UI のプレビューは、同じパラメータと時刻から同じ絵を描く。

### 3.3 Native addon（`native/`、N-API、自前実装に一本化）

| | macOS | Windows |
|---|---|---|
| 送出 | Syphon.framework（同梱）、`SyphonMetalServer` | SpoutDX（Spout2 SDK を vendor に置く） |
| 受け取るテクスチャ | IOSurface → MTLTexture | DXGI 共有ハンドル → ID3D11Texture2D |
| 合成 | Metal のフラグメントシェーダー | D3D11 のピクセルシェーダー |

- node-syphon と、そのメモリリーク対策のパッチ済みバイナリはやめる。
- **ビルド済みのバイナリを CI で作って同梱**する。利用者にも開発者にもコンパイラを要求しない（旧版では Windows で VS Build Tools が必須だった）。
- JS 側からは OS に関係なく `createSender(name)` / `compose(layers)` / `publish(...)` で扱えるようにする。

### 3.4 YouTube プレイヤーと offscreen 描画
- プレイヤーは offscreen の WebContents（`offscreen: { useSharedTexture: true }`）で描画する。
- UI のプレビューには、縮小したフレームを canvas に描く。
- **操作の分担**：
  - クリック・スクロール・ホバーは、プレビュー上の座標を変換して `sendInputEvent` でプレイヤーに転送する。
  - **文字入力はアプリ側の検索バーだけ**にする。フリーワードは YouTube 検索、URL はそのまま開く（旧版と同じ挙動）。こうすることで日本語 IME を offscreen に通す問題を避ける。
- 旧版から引き継ぐもの：プレイヤー以外を隠す CSS、広告スキップ、字幕 OFF、画質の固定、閲覧ページでは黒を出す挙動。注入するコードは `src/main/youtube/` に `.css` / `.ts` として独立させ、文字列リテラルに埋め込まない。

### 3.5 GPU 経路が使えなかった場合
Phase 0 で共有テクスチャの経路が成り立たなかったら、CPU 経路に切り替える。
- `beginFrameSubscription`（または offscreen の `paint` イベント）で BGRA を受け取る。
- レターボックス・合成・色の並べ替えは **addon 側の C++** で行い、JS のループでは処理しない。
- Sink のインターフェースは変えないので、上の層には影響しない。

---

## 4. 技術スタック

| 用途 | 採用 |
|---|---|
| ランタイム | Electron（最新安定版）+ TypeScript |
| ビルド | electron-vite |
| パッケージング | electron-builder（mac は dmg/zip、Win は NSIS） |
| UI | React |
| テスト | Vitest（URL の解析、store の更新処理、汎用パラメータ、ミキサーの状態遷移など） |
| CI | GitHub Actions：macos-14（arm64）と windows-latest（x64）でビルド・テスト・addon の読み込み確認を行い、タグを打ったら Releases に配布物を置く |

## 5. ディレクトリ構成

```
ikvj/
  docs/DESIGN.md
  native/                 N-API addon（mac: Obj-C++/Metal, win: C++/D3D11）
    src/engine.h          両 OS 共通のインターフェース
    test/selftest.cjs     Electron なしで動くセルフテスト
  vendor/                 Syphon.framework, Spout2 SDK
  src/
    shared/               main と renderer の両方が使う、副作用のないコード
      state.ts            AppState の型と初期値、定数（出力名・解像度など）
      actions.ts          アクションの zod スキーマ（renderer からの入力を検証）
      reducer.ts          状態遷移（純粋関数）
      ipc.ts              IPC チャンネル名と window.ikvj の型
    main/
      index.ts            起動、ウィンドウ、IPC の受け口
      store.ts            状態を持ち、変更を購読者に通知する
      pipeline.ts         Engine と送信元を状態に合わせて作り直す、ミックスのループ
      native.ts           addon の読み込みと型付け
      sources/            youtube.ts, generative.ts（Phase 2〜3）
      youtube/            注入する CSS/JS、画質制御（Phase 2）
      auth/               Google ログイン（Phase 6）
    preload/index.ts      window.ikvj を公開する（sandbox 有効、CJS で出力）
    renderer/src/
      store.ts            状態の購読（useAppState / useStats）と dispatch
      components/         TopBar, Tile, Mixer, OutputStatus ...
      gen/                sketch.ts, palette.ts, print.ts（旧版から移植、Phase 3）
```

### 状態の流れ
1. UI は `window.ikvj.dispatch(action)` を呼ぶだけで、状態を直接書き換えない。
2. main は `parseAction`（zod）で検証してから `reduce` に通す。不正な入力は拒否して、状態は変えない。
3. 新しい状態は UI に全体を配信する。`Pipeline` は前の状態との差分を見て、エンジンや送信元を作り直す（命令ではなく、状態に合わせる）。
4. fps や受信中かどうかといった実行時の数値は状態に含めず、`stats` として 1 秒ごとに送る。

---

## 6. 進め方

| Phase | 内容 | 終わったと言える状態 |
|---|---|---|
| 0 | **技術検証**：addon の雛形、共有テクスチャから Syphon/Spout へ、GPU 合成 | mac と Win の両方で、YouTube 1 本と汎用 1 本を 1080p60 で受信でき、2 つを合成した MIX も出る。CPU 使用率を測って続けるか判断する |
| 1 | 骨組み：electron-vite、store、型付き IPC、CI | 両 OS の CI が通る |
| 2 | YouTube ソース（A）→ ikvj-A | 検索、再生操作、プレビューからのクリックができる |
| 3 | 4 ソースと 2×2 レイアウト（B, C, D、全体の BPM） | 4 つのタイルが動く |
| 4 | ミキサー（4ch、並べ替え、Solo）→ ikvj-MIX | 旧版の VJ モードでできたことを置き換えられる |
| 5 | プロジェクター、解像度と fps の設定 | |
| 6 | Google ログイン、状態の保存と復元 | |
| 7 | 配布：electron-builder で Releases に自動で置く | 他の人がダウンロードして起動できる |

## 7. 旧版から変わる点（利用者向けの告知用）
- 出力名が `URLtoSyphon-L/R`・`TubeToSyphon`・`TubeToSyphon-GEN` から `ikvj-A..D`・`ikvj-MIX` に変わる。VJ ソフト側で受信元を選び直す必要がある。
- Dual / VJ モードはなくなり、4ch ミキサーに統合される。
- 汎用出力が 2 系統になる。
