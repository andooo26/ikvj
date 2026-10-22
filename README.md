# ikvj

YouTube 2 本と汎用（ジェネラティブ）グラフィックス 2 本をミックスして、**Syphon**（macOS）/ **Spout**（Windows）と、プロジェクターに出力する VJ ツール。

- **A / B**：YouTube（検索・URL 貼り付け・プレビュー上でクリックして操作）
- **C / D**：BPM に同期する汎用グラフィックス（Techno、House、Kawaii、Hyperpop ほか 8 種類）
- **4ch ミキサー**：レイヤーの重ね順はドラッグで入れ替え、Solo で自動フェード
- **出力**：`ikvj-MIX` は常時。`ikvj-A`〜`ikvj-D` はソースごとに ON/OFF。プロジェクターには A〜D か MIX を全画面で出す
- 映像は GPU だけを通る（CPU でのピクセルのコピーなし）。解像度は 720p / 1080p / 2160p、30 / 60fps から選べる

## インストール

[Releases](https://github.com/andooo26/ikvj/releases) から、使っている OS のファイルをダウンロードする。

| OS | ファイル |
|---|---|
| macOS（Apple Silicon） | `ikvj-<版>-arm64.dmg` |
| Windows（x64） | `ikvj-Setup-<版>.exe` |

### 初回の起動について（署名なしで配布しているため）
- **macOS**：ダブルクリックで開くと「開発元を確認できない」と出て開けない。Finder でアプリを**右クリック →「開く」→「開く」**を選ぶ。2 回目からは普通に開ける。
  - それでも「壊れている」と出る場合は、ターミナルで `xattr -cr /Applications/ikvj.app` を実行してから開く。
- **Windows**：「Windows によって PC が保護されました」と出たら、**「詳細情報」→「実行」**を選ぶ。

## 使い方

1. A / B のタイルで YouTube を検索するか URL を貼り付けて「開く」。検索結果はプレビュー上でクリックして選べる（検索結果を見ている間、そのソースの出力は黒になる）。
2. C / D でジャンル・Intensity・Tint を選ぶ。BPM は上部バーで入力するか、Tap で合わせる。
3. 下のミキサーで各チャンネルの不透明度を決める。左ほど上のレイヤー。**S**（Solo）を押すと、そのチャンネルだけになるようにフェードする。
4. VJ ソフト（SynapseRack、Resolume、TouchDesigner など）で `ikvj-MIX` などを受信する。
5. 上部バーの「Projector」で、出すものとディスプレイを選んで「投影」を押す。投影中のウィンドウで **Esc** を押すと閉じる。

YouTube Premium のアカウントで「Google ログイン」すると、広告が出なくなる。

### 旧 Tube to Syphon からの移行
- 出力名が変わった：`URLtoSyphon-L/R`・`TubeToSyphon`・`TubeToSyphon-GEN` → `ikvj-A`〜`ikvj-D`・`ikvj-MIX`。受信側で選び直す。
- Dual / VJ モードは 4ch ミキサーに統合された。汎用出力は 2 系統になった。

## 開発

必要なもの：Node.js 24。macOS は Xcode Command Line Tools、Windows は Visual Studio 2022 Build Tools（C++ によるデスクトップ開発）と Python 3。

```bash
npm install
npm run build:native   # GPU エンジン（native/）をビルド
npm run dev            # 開発モードで起動
npm test               # 単体テスト
npm run test:native    # GPU エンジンのセルフテスト
npm run typecheck
```

配布物を手元で作る：`npm run dist -- --mac --publish never`（Windows では `--win`）。成果物は `dist/` に出る。

### リリース
1. `package.json` の `version` を上げてコミットする。
2. 同じ番号のタグを push する：`git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions が macOS と Windows の配布物を作り、**下書き**の Release に添付する。中身を確かめてから公開する。

設計は [docs/DESIGN.md](docs/DESIGN.md) を参照。
