# SNS/YouTube 情報収集の自動化フロー(無料版)

X(Twitter) のブックマークと、YouTube各チャンネルの新着・人気動画を自動で集め、
AIで要約したレポートを Google Docs に自動保存する n8n ワークフロー。
収集・要約はAIが行い、「何が重要か」の最終判断はユーザー自身が行う設計。

X API・YouTube Data APIとも、有料プランが必須な部分は使わず(YouTube Data APIは無料枠のみで運用)、
無料で完結する構成にしています。

- ワークフロー: [X Bookmark Daily Digest](https://yoshi0418.app.n8n.cloud/workflow/v7Pq04POZSMicf43)
- 実行頻度: 毎日 12:00 と 21:00 の1日2回(日本時間 / Asia/Tokyo)
- データソース:
  - X: Googleスプレッドシート「X Bookmarks Inbox」(共有→メールで自動追記、下記参照)
  - YouTube: 10チャンネルをRSSで30分ごとに自動監視 + 過去の人気動画は手動ボタンで一括取得
- 保存先: Google Docs(実行のたびに1ドキュメント。タイトルに日時を含むため12:00分/21:00分は別ファイルになります)

> 旧バージョン(X API Bookmarks エンドポイントを使う有料プラン前提の構成)はアーカイブ済みです。

**動作確認済み(2026-08-29)**: X(メール経由)・YouTube(RSS監視・過去動画バックフィル)とも、実データでテスト実行し成功しています。

## 全体の流れ

### X ブックマーク

1. Xアプリで投稿を共有→「メール」→自分宛てに送信(下記参照)
2. **Watch for Bookmark Emails**(Gmail Trigger, 5分ごと)— 自分宛てメールを検知し、本文からURLを抽出、投稿ページから本文を自動取得してシートに追記
3. **Twice Daily Trigger (12:00 / 21:00)** — 日本時間12:00と21:00に起動
4. **Read Bookmarks Sheet → Filter Unprocessed Rows** — `processed` 列が `TRUE` でない行だけに絞り込み
5. (分岐A) **Mark Rows Processed** — 処理済みに更新(重複分析防止)
6. (分岐B) YouTubeの未処理分と合流 → **Build Report Prompt → Analyze Bookmarks(AI)** — トピック別に4項目(概要/具体的な要点/注目ポイント/示唆)で分析し、最後に「How to: AIを育てる実践ガイド」を含む日本語レポート(Markdown)を生成
7. **Report Markdown to HTML → Build Report HTML Document → Build Report Multipart Body → Upload Report Doc** — MarkdownをHTMLに変換して色付き・太字のスタイルを付け、Google Drive APIで新規Google Docsとして保存(詳細は下記「レポートの見た目」を参照)
8. **Send Report Notification**(Gmail) — レポート作成後、`vllyb.0418@gmail.com` 宛にタイトルとGoogle Docsリンクをメールで通知(件名: 「(レポート名) が完成しました」)

新規分が0件の日はレポートが自然に作られない(空のレポートを作らない設計)。この場合は通知メールも送信されません。

### YouTube(下記「YouTube連携」を参照)

- 10チャンネルをRSSで30分ごとに監視 → 新着があれば上記のXブックマークと同じレポートに合流
- 過去の人気動画は「Run YouTube Backfill」ボタンで手動実行 → 別建てのGoogle Docsに一括レポート化

## 事前準備(ユーザー側で実施が必要)

### 1. Googleスプレッドシートを作成

「X Bookmarks Inbox」のような名前でスプレッドシートを新規作成し、1行目(見出し)に以下の列名を入力してください。

| url | text | author | postedAt | processed | processedAt |
|---|---|---|---|---|---|

- `url`, `text` は必須(投稿のURLと本文)
- `author`, `postedAt` は任意(わかる範囲でOK)
- `processed`, `processedAt` は空欄のままでOK(ワークフローが自動で埋めます)

### 2. ブックマークをシートに追記する運用

**現在の運用方法(iPhone/スマホ向け・推奨)**: Xアプリで投稿を共有 → 「メール」を選択 →
自分自身のGmailアドレス(`vllyb.0418@gmail.com`)宛てに送信するだけ。
n8nの `Watch for Bookmark Emails`(Gmail Trigger)が5分ごとに受信を確認し、
本文からURLを抽出、投稿ページから本文を自動取得してシートに追記します。
ブラウザやブックマークレットは不要で、iPhone標準のメール共有機能だけで完結します。

- Gmail Triggerのフィルタ: `to:自分 from:自分`、既読/未読どちらでも検知(`readStatus: both`)
- 本文取得: 投稿ページの `og:description` メタタグを正規表現で抽出(Xの本文プレビュー用データを流用)
- 処理済みメールはGmail側の既読フラグには依存せず、Gmail Triggerが内部で重複検知を行う

**PC/ブラウザ向けの代替方法(旧版)**: 以下の「ブックマークレット」方式も動作します。
スマホアプリ経由が難しい場合や、PCでXを見ている場合はこちらでも構いません。

#### 2-1. Google Apps Script を用意する(スプレッドシート側の受け口)

1. 手順1で作ったスプレッドシートを開き、メニューの **拡張機能 → Apps Script** をクリック
2. 開いたエディタの中身をすべて削除し、以下のコードを貼り付けて保存(💾アイコン)

```javascript
function doGet(e) {
  var ss = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID');
  var sheet = ss.getSheets()[0];
  var url = e.parameter.url || '';
  var text = e.parameter.text || '';
  var author = e.parameter.author || '';
  if (!url || !text) {
    return ContentService.createTextOutput('❌ url または text が空です。');
  }
  sheet.appendRow([url, text, author, new Date().toISOString(), '', '']);
  return ContentService.createTextOutput('✅ ブックマークを追加しました。このタブは閉じてOKです。');
}
```

  `YOUR_SPREADSHEET_ID` は、スプレッドシートのURL(`https://docs.google.com/spreadsheets/d/【ここ】/edit`)の
  `/d/` と `/edit` の間にある文字列に置き換えてください。

  > `SpreadsheetApp.getActiveSpreadsheet()` はWeb App経由の実行では `null` を返すことがあり、
  > `TypeError: Cannot read properties of null (reading 'appendRow')` の原因になります。
  > `openById` で明示的に指定するのが確実です。`getSheets()[0]` なので、シート名が「Sheet1」でも「シート1」でも動きます。

3. 右上の **デプロイ → 新しいデプロイ** をクリック
4. 種類の選択(歯車アイコン)で **ウェブアプリ** を選択
5. 「次のユーザーとして実行」= **自分**、「アクセスできるユーザー」= **全員** に設定して **デプロイ**
6. 表示された **ウェブアプリのURL**(`https://script.google.com/macros/s/.../exec` の形)をコピーしておく
   (自分だけが知っているURLです。他人と共有しないでください)

#### 2-2. ブックマークレットを作る(ブラウザのワンクリックボタン)

1. 下のコードの `YOUR_WEB_APP_URL` の部分を、2-1でコピーしたURLに置き換える

```javascript
javascript:(function(){var t=document.querySelector('article[data-testid="tweet"]');var x=t?t.innerText.replace(/\s+/g,' ').trim().slice(0,1800):document.title;var u='YOUR_WEB_APP_URL';var p='?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(x);window.open(u+p,'_blank','width=420,height=200');})();

```

2. ブラウザのブックマークバーを表示し、新しいブックマークを追加
   - 名前: 例)「Xブックマーク→シート」
   - URL(リンク先): 上で置き換えたコード全体をそのまま貼り付け
3. これで完成。Xで投稿(ツイート)を開いた状態でこのブックマークをクリックすると、
   ポップアップが開いて「✅ ブックマークを追加しました」と表示され、シートに1行追加されます
   - タイムライン上ではなく、**投稿の詳細ページ**(その投稿単体が表示されるページ)を開いた状態でクリックしてください
   - 本文の抽出はページの構造に依存するため、まれにうまく取れないことがあります。その場合はシートを直接編集してください

自動化が不要になった場合や気に入らない場合は、いつでも手動でシートに1行追加する方法に戻せます。

### 3. n8n の Credentials を作成

n8n の Credentials 画面で以下を作成してください(セキュリティ上、Claude側では作成できません)。

1. **Google Sheets account**(OAuth2)
2. **Google Docs account**(OAuth2)— 現在は未使用(旧方式の名残)。将来的に削除しても構いません
3. **Google Drive account**(OAuth2)— レポートをHTML→Googleドキュメント変換で保存するのに必要
4. **Gmail account**(OAuth2) — Xブックマークのメール検知用
5. **Youtube API Key**(Query Auth, パラメータ名 `key`)— YouTube連携用。取得手順は下記「YouTube連携」を参照

### レポートの見た目(色付き・太字)

AIの出力はMarkdown形式(`##`見出し、`**太字**`、`- `箇条書き)にしてから、
`Markdown`ノードでHTMLに変換し、見出しに色(青系の背景、緑の下線)・太字ラベルにオレンジ色を
インラインスタイルで付与しています。そのHTMLを、Google Docsノード(プレーンテキストのみ対応)ではなく
**Google Drive APIの直接アップロード**(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`、
`mimeType: application/vnd.google-apps.document` を指定してHTML→Googleドキュメント変換)で保存しています。
これにより、見出し・太字・色などのメリハリがドキュメントに反映されます。

該当ノード: `Report Markdown to HTML` → `Build Report HTML Document` → `Build Report Multipart Body` → `Upload Report Doc`
(バックフィル版は `Backfill Markdown to HTML` → `Build Backfill HTML Document` → `Build Backfill Multipart Body` → `Upload Backfill Report Doc`)

色やスタイルを変更したい場合は、`Build Report HTML Document` / `Build Backfill HTML Document` の
`jsCode` 内にある `style="..."` の値を編集してください。

### 4. ワークフロー内でシート/フォルダを選択

- `Read Bookmarks Sheet` と `Mark Rows Processed` ノードで、作成したスプレッドシートとシート名を選択
- `Create Report Doc` / `Create Backfill Report Doc` ノードで、レポートを保存する Google Drive のフォルダを選択

すべて設定したら、対応する Credential を各ノードに割り当ててワークフローを Activate してください。
OpenAI(分析用)は既存のクレジットを自動でセット済みです。

## YouTube連携

Xと同様、**無料のRSSフィード**と**無料のYouTube Data API**だけで完結する構成です(有料プラン不要)。

### 監視中の10チャンネル

| チャンネル名 | チャンネルID |
|---|---|
| 上場社長 秋好陽介【AI×経営】 | UCEO389HqxYFp7WhfmXV-5WQ |
| Chatgpt研究所 | UCNornXnTka3v29_9xBlarvQ |
| からあげ | UClxiDwyZllEbHekbCAfFhiA |
| 東京大学 松尾・岩澤研究室 | UCki6YFDC_OpeCxmYEBCUXhg |
| ITmedia NEWS | UCiaJg01CSD75sYvZIe1Oi9A |
| PIVOT 公式チャンネル | UC8yHePe_RgUBE-waRWy6olw |
| Matt Wolfe | UChpleBmo18P08aKCIgti38g |
| Two Minute Papers | UCbfYPyITQ-7l4upoX8nvctg |
| AI Explained | UCNJ1Ymd5yFuUPtn21xtRbbw |
| The AI Advantage | UCHhYXsLBEVVnbvsq57n1MTQ |

### 今後の新着動画(自動・無料)

`Watch YouTube: ○○` という名前のRSS Feed Triggerノードが、各チャンネルにつき1つ、
`https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID` を30分ごとに監視しています。
新着があれば `Extract Video Info → Filter New Video → Log New Video` でn8nのData Table
(`youtube_video_log`)に記録され、次回の12:00/21:00のレポートにXブックマークと合わせて
「【YouTube新着動画】」セクションとして反映されます。

### 過去の人気動画(手動・1回限り)

`Run YouTube Backfill` という手動実行ボタン(Manual Trigger)で、各チャンネルの
「AI」キーワードに一致する再生数上位3本ずつ(YouTube Data APIの `search.list`、
`order=viewCount`)を取得し、チャンネル別に分類したレポートを
「YouTube人気動画まとめ - (日付)」という別のGoogle Docsに作成します。
通常の定期レポートには混ざりません(取得した動画は `processed=TRUE` として記録)。
完成すると `Send Backfill Notification`(Gmail)が `vllyb.0418@gmail.com` 宛にタイトルと
Google Docsリンクを通知します(12:00/21:00レポートの通知と同じ仕組み)。

チャンネルを追加・変更したい場合は、`Channel List` ノード(バックフィル用)と
`Watch YouTube: ○○` ノード群(新着監視用)の両方を編集してください。

### YouTube Data APIキーの取得(無料・カード登録不要)

1. https://console.cloud.google.com/ でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」→ **YouTube Data API v3** を有効化
3. 「認証情報」→ **APIキー** を作成してコピー
4. n8nのCredentials画面で **Query Auth** を新規作成し、Name: `key`、Value: 取得したAPIキーを設定、
   名前を「Youtube API Key」に

YouTube Data APIは1日10,000ユニットの無料枠があり、この用途では十分収まります。

## 重複防止の仕組み

スプレッドシートの `processed` 列に処理済みフラグを立てることで、
翌日以降は同じ行を再分析しないようにしています。

## トラブルシューティング

- **`TypeError: Cannot read properties of null (reading 'appendRow')`**: Apps Scriptで
  `getActiveSpreadsheet()` を使っていると発生することがあります。`openById('スプレッドシートID')` に変更してください。
- **見出しセルの表記ゆれ**: `url ` のように余分な空白が入っていると、n8n側でその列が正しく読み取れず
  レポートに `undefined` と出ることがあります。`Build Report Prompt` ノードは見出しの前後の空白を無視するように
  対応済みですが、気になる場合はシートの見出しセル自体を修正しても構いません。
- **同じ名前のスプレッドシートを複数作ってしまった場合**: Apps Scriptの`openById`のID、
  n8nの`Read Bookmarks Sheet`/`Mark Rows Processed`ノードのスプレッドシート指定が
  すべて同じIDを指しているか確認してください。

## カスタマイズ

- 実行時刻/頻度: `Twice Daily Trigger (12:00 / 21:00)` ノードのスケジュール設定を変更
- レポート形式: `Analyze Bookmarks` ノードの `systemMessage` を編集
- 有料のX APIを使えるようになった場合は、`Read Bookmarks Sheet` / `Filter Unprocessed Rows` /
  `Mark Rows Processed` を X API 経由のブックマーク取得ノードに差し替えることで自動収集に切り替え可能
