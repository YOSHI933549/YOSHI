# X ブックマーク分析の自動化フロー(無料版)

X(Twitter) でブックマークした投稿を毎日分析し、AIで要約したレポートを
Google Docs に自動保存する n8n ワークフロー。

X API の有料プラン(Basic以上)が必要な「ブックマークAPI」は使わず、
**Googleスプレッドシートへの手動転記**をデータソースにすることで無料で運用できる構成にしています。

- ワークフロー: [X Bookmark Daily Digest](https://yoshi0418.app.n8n.cloud/workflow/v7Pq04POZSMicf43)
- 実行頻度: 毎日 12:00 と 21:00 の1日2回(日本時間 / Asia/Tokyo)
- データソース: Googleスプレッドシート「X Bookmarks Inbox」(手動転記)
- 保存先: Google Docs(実行のたびに1ドキュメント。タイトルに日時を含むため12:00分/21:00分は別ファイルになります)

> 旧バージョン(X API Bookmarks エンドポイントを使う有料プラン前提の構成)はアーカイブ済みです。

**動作確認済み(2026-08-29)**: ブックマークレット→シート追記→n8nの読み込み→AI分析→Google Docsレポート作成まで、実際のブックマーク投稿でテスト実行し成功しています。

## 全体の流れ

1. **Twice Daily Trigger (12:00 / 21:00)** — Schedule Trigger で日本時間12:00と21:00に起動
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

### 2. ブックマークをシートに転記する運用(ワンクリックボタン方式)

ブラウザ拡張のインストールや有料連携は使わず、**「ブックマークレット」**という
ブラウザの「ブックマークバーに置く1個のボタン」でワンクリック自動追記にできます。
Xで投稿を開いた状態でこのボタンを押すと、URLと本文が自動でシートに追記されます。

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
2. **Google Docs account**(OAuth2)

### 4. ワークフロー内でシート/フォルダを選択

- `Read Bookmarks Sheet` と `Mark Rows Processed` ノードで、作成したスプレッドシートとシート名を選択
- `Create Report Doc` ノードで、レポートを保存する Google Drive のフォルダを選択

すべて設定したら、対応する Credential を各ノードに割り当ててワークフローを Activate してください。
OpenAI(分析用)は既存のクレジットを自動でセット済みです。

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
