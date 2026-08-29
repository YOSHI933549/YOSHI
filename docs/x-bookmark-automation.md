# X ブックマーク分析の自動化フロー(無料版)

X(Twitter) でブックマークした投稿を毎日分析し、AIで要約したレポートを
Google Docs に自動保存する n8n ワークフロー。

X API の有料プラン(Basic以上)が必要な「ブックマークAPI」は使わず、
**Googleスプレッドシートへの手動転記**をデータソースにすることで無料で運用できる構成にしています。

- ワークフロー: [X Bookmark Daily Digest](https://yoshi0418.app.n8n.cloud/workflow/v7Pq04POZSMicf43)
- 実行頻度: 毎日 8:00
- データソース: Googleスプレッドシート「X Bookmarks Inbox」(手動転記)
- 保存先: Google Docs(1日1ドキュメント)

> 旧バージョン(X API Bookmarks エンドポイントを使う有料プラン前提の構成)はアーカイブ済みです。

## 全体の流れ

1. **Daily 08:00 Trigger** — Schedule Trigger で毎朝起動
2. **Read Bookmarks Sheet** — スプレッドシート「X Bookmarks Inbox」の全行を取得
3. **Filter Unprocessed Rows** — `processed` 列が `TRUE` でない行(=まだ分析していないブックマーク)だけに絞り込み
   - 新規分が0件の日はここで処理が自然に終了し、空のレポートは作られない
4. (分岐A) **Mark Rows Processed** — 該当行の `processed` を `TRUE` に更新(重複分析防止)
5. (分岐B) **Build Report Prompt → Analyze Bookmarks(AI)** — 新規ブックマークをトピック別に分析する日本語レポートを生成
6. **Create Report Doc → Write Report Content** — Google Docs に新規ドキュメントを作成し、レポート本文を書き込み

## 事前準備(ユーザー側で実施が必要)

### 1. Googleスプレッドシートを作成

「X Bookmarks Inbox」のような名前でスプレッドシートを新規作成し、1行目(見出し)に以下の列名を入力してください。

| url | text | author | postedAt | processed | processedAt |
|---|---|---|---|---|---|

- `url`, `text` は必須(投稿のURLと本文)
- `author`, `postedAt` は任意(わかる範囲でOK)
- `processed`, `processedAt` は空欄のままでOK(ワークフローが自動で埋めます)

### 2. ブックマークをシートに転記する運用

Xでブックマークした投稿を見つけたら、`url` と `text` を上記シートに1行追加してください。
(将来的にブラウザ拡張や共有シートアプリと連携すれば自動転記も可能ですが、まずは手動運用から開始します)

### 3. n8n の Credentials を作成

n8n の Credentials 画面で以下を作成してください(セキュリティ上、Claude側では作成できません)。

1. **Google Sheets account**(OAuth2)
2. **Google Docs account**(OAuth2)

### 4. ワークフロー内でシート/フォルダを選択

- `Read Bookmarks Sheet` と `Mark Rows Processed` ノードで、作成したスプレッドシートとシート名を選択
- `Create Report Doc` ノードで、レポートを保存する Google Drive のフォルダを選択

すべて設定したら、対応する Credential を各ノードに割り当ててワークフローを Activate してください。
OpenAI(分析用)は既存のクレジットを自動でセット済みです。

## 重複防止の仕組み

スプレッドシートの `processed` 列に処理済みフラグを立てることで、
翌日以降は同じ行を再分析しないようにしています。

## カスタマイズ

- 実行時刻/頻度: `Daily 08:00 Trigger` ノードのスケジュール設定を変更
- レポート形式: `Analyze Bookmarks` ノードの `systemMessage` を編集
- 有料のX APIを使えるようになった場合は、`Read Bookmarks Sheet` / `Filter Unprocessed Rows` /
  `Mark Rows Processed` を X API 経由のブックマーク取得ノードに差し替えることで自動収集に切り替え可能
