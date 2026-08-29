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

### 2. ブックマークをシートに転記する運用(ワンクリックボタン方式)

ブラウザ拡張のインストールや有料連携は使わず、**「ブックマークレット」**という
ブラウザの「ブックマークバーに置く1個のボタン」でワンクリック自動追記にできます。
Xで投稿を開いた状態でこのボタンを押すと、URLと本文が自動でシートに追記されます。

#### 2-1. Google Apps Script を用意する(スプレッドシート側の受け口)

1. 手順1で作ったスプレッドシートを開き、メニューの **拡張機能 → Apps Script** をクリック
2. 開いたエディタの中身をすべて削除し、以下のコードを貼り付けて保存(💾アイコン)

```javascript
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
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

  (シート名が「Sheet1」でない場合は `'Sheet1'` の部分を実際のシート名に変更してください)

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

## カスタマイズ

- 実行時刻/頻度: `Daily 08:00 Trigger` ノードのスケジュール設定を変更
- レポート形式: `Analyze Bookmarks` ノードの `systemMessage` を編集
- 有料のX APIを使えるようになった場合は、`Read Bookmarks Sheet` / `Filter Unprocessed Rows` /
  `Mark Rows Processed` を X API 経由のブックマーク取得ノードに差し替えることで自動収集に切り替え可能
