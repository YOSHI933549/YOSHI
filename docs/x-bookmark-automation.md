# X ブックマーク分析の自動化フロー

X(Twitter) でブックマークした投稿を毎日収集し、AIで分析・要約したレポートを
Google Docs に自動保存する n8n ワークフロー。

- ワークフロー: [X Bookmark Daily Digest](https://yoshi0418.app.n8n.cloud/workflow/Owz88eg4vBxzJhi0)
- 実行頻度: 毎日 8:00
- 保存先: Google Docs(1日1ドキュメント)

## 全体の流れ

1. **Daily 08:00 Trigger** — Schedule Trigger で毎朝起動
2. **Get My X User ID** — `GET /2/users/me` で自分のユーザーIDを取得
3. **Get Bookmarks** — `GET /2/users/:id/bookmarks` で最新のブックマーク(最大100件)を取得
4. **Format Bookmarks** — レスポンスをツイートごとの1アイテムに整形
5. **Filter Unseen Bookmarks** — Data Table `x_bookmark_log` と照合し、まだ処理していない投稿だけに絞り込み
   - 新規分が0件の日はここで処理が自然に終了し、空のレポートは作られない
6. (分岐A) **Log New Bookmarks** — 処理済みとして Data Table に記録(重複分析防止)
7. (分岐B) **Build Report Prompt → Analyze Bookmarks(AI)** — 新規ブックマークをトピック別に分析する日本語レポートを生成
8. **Create Report Doc → Write Report Content** — Google Docs に新規ドキュメントを作成し、レポート本文を書き込み

## 事前準備(ユーザー側で実施が必要)

n8n の Credentials 画面で以下を作成してください(セキュリティ上、Claude側では作成できません)。

1. **X (Twitter) account**(OAuth2)
   - X Developer Portal でアプリを作成し、OAuth 2.0 (User context) を有効化
   - 必要スコープ: `bookmark.read`, `tweet.read`, `users.read`
   - ブックマークAPIは有料プラン(Basic以上)が必要です
2. **Google Docs account**(OAuth2)
   - 通常の Google OAuth2 連携で作成
3. ワークフロー内の **Create Report Doc** ノードで、レポートを保存する Google Drive のフォルダを選択

上記の認証情報を作成したら、`Get My X User ID` / `Get Bookmarks` / `Create Report Doc` /
`Write Report Content` の各ノードで対応する Credential を選択し、ワークフローを Activate してください。

## 重複防止の仕組み

n8n の Data Table `x_bookmark_log`(列: `tweetId`, `text`, `author`, `url`, `postedAt`, `processedAt`)
に処理済みのツイートIDを記録し、翌日以降は同じ投稿を再分析しないようにしています。

## カスタマイズ

- 実行時刻/頻度: `Daily 08:00 Trigger` ノードのスケジュール設定を変更
- レポート形式: `Analyze Bookmarks` ノードの `systemMessage` を編集
- 取得件数: `Get Bookmarks` ノードの `max_results` パラメータ(最大100)
