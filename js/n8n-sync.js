/* ==========================================================================
   n8n経由の体重自動取り込み(任意機能)
   ==========================================================================
   仕組み:
   - iPhoneの「ショートカット」自動化が、Apple Healthの最新体重を
     n8nのWebhook(POST)に送信 → n8nがData Tableに保存
   - このスクリプトは、n8nの別のWebhook(GET)を定期的に叩いて記録一覧を取得し、
     まだこのアプリに存在しない日付だけを体重ログに追加する(「隙間を埋める」方式)
   - 手動でこのアプリ上で入力・編集した記録は上書きしない(常にアプリ側が優先)

   取得用URL(トークンを含む)は、公開リポジトリのコードには一切含めず、
   ユーザーがブラウザ内(localStorage)にのみ保存する。
   ========================================================================== */

const N8N_URL_KEY = "yoshi-n8n-fetch-url";
// 体重ログのうち n8n から取り込んだものに付ける印(手入力の記録と区別するため)
const N8N_SOURCE = "n8n";
let n8nFetchInFlight = false;

function getN8nFetchUrl() {
  try {
    return localStorage.getItem(N8N_URL_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setN8nStatus(text) {
  const el = document.getElementById("n8nStatusText");
  if (el) el.textContent = text;
}

function initN8nSync() {
  const urlInput = document.getElementById("n8nFetchUrl");
  const saveBtn = document.getElementById("n8nSaveUrlBtn");
  const fetchBtn = document.getElementById("n8nFetchNowBtn");
  if (!urlInput || !saveBtn || !fetchBtn) return;

  const saved = getN8nFetchUrl();
  if (saved) {
    urlInput.value = saved;
    setN8nStatus("設定済みです。自動で定期的に取得します。");
  } else {
    setN8nStatus("未設定です。URLを貼り付けて保存してください。");
  }

  saveBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    try {
      localStorage.setItem(N8N_URL_KEY, url);
    } catch (e) {
      toast("保存に失敗しました");
      return;
    }
    toast(url ? "保存しました" : "URLを削除しました");
    if (url) fetchFromN8n(true);
    else setN8nStatus("未設定です。URLを貼り付けて保存してください。");
  });

  fetchBtn.addEventListener("click", () => fetchFromN8n(true));

  if (saved) fetchFromN8n(false);

  // Poll fairly aggressively while the app is open/visible so a weigh-in
  // shows up as soon as possible after the iPhone side posts it — but pause
  // entirely while backgrounded so it doesn't run forever in a hidden tab.
  setInterval(() => {
    if (getN8nFetchUrl() && document.visibilityState === "visible") fetchFromN8n(false);
  }, 20000); // 20秒ごと(表示中のみ)

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getN8nFetchUrl()) fetchFromN8n(false);
  });
}

async function fetchFromN8n(showToast) {
  const url = getN8nFetchUrl();
  if (!url || n8nFetchInFlight) return;
  n8nFetchInFlight = true;
  setN8nStatus("取得中...");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected response shape");

    // 日付ごとに既存の記録を引けるようにしておく
    const byDate = new Map(state.weightLogs.map((l) => [l.date, l]));
    let added = 0;
    let updated = 0;
    rows.forEach((row) => {
      const date = row && row.date;
      const weight = row && Number(row.weight);
      if (!date || !weight) return;

      const existing = byDate.get(date);
      if (!existing) {
        // まだ無い日付は新規に追加する。source を残しておくことで、
        // 次回以降この記録が n8n 由来かどうかを判定できるようにする
        const entry = { id: uid(), date, weight, source: N8N_SOURCE };
        state.weightLogs.push(entry);
        byDate.set(date, entry);
        added++;
        return;
      }

      // すでにある日付でも、n8n から取り込んだ記録なら最新の値で更新する
      // (体重計で測り直した場合や、以前の取り込みが古い値だった場合のため)。
      // アプリ内で手入力・編集した記録には source が無いので、常に手入力側を優先する。
      if (existing.source === N8N_SOURCE && existing.weight !== weight) {
        existing.weight = weight;
        updated++;
      }
    });

    if (added > 0 || updated > 0) {
      saveState();
      renderAll();
      if (showToast) {
        const parts = [];
        if (added > 0) parts.push(`${added}件を追加`);
        if (updated > 0) parts.push(`${updated}件を更新`);
        toast(`体重を${parts.join("、")}しました`);
      }
    } else if (showToast) {
      toast("新しい記録はありませんでした");
    }
    setN8nStatus(`最終取得: ${nowTimeStr()}(追加${added}件・更新${updated}件)`);
  } catch (e) {
    console.error("n8n fetch failed", e);
    setN8nStatus("取得に失敗しました。URLを確認してください。");
    if (showToast) toast("取得に失敗しました");
  } finally {
    n8nFetchInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", initN8nSync);
