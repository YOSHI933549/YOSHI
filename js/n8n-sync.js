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
  setInterval(() => {
    if (getN8nFetchUrl()) fetchFromN8n(false);
  }, 300000); // 5分ごと
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

    const existingDates = new Set(state.weightLogs.map((l) => l.date));
    let added = 0;
    rows.forEach((row) => {
      const date = row && row.date;
      const weight = row && Number(row.weight);
      if (!date || !weight || existingDates.has(date)) return;
      state.weightLogs.push({ id: uid(), date, weight });
      existingDates.add(date);
      added++;
    });

    if (added > 0) {
      saveState();
      renderAll();
      if (showToast) toast(`体重を${added}件取り込みました`);
    } else if (showToast) {
      toast("新しい記録はありませんでした");
    }
    setN8nStatus(`最終取得: ${nowTimeStr()}(新規${added}件)`);
  } catch (e) {
    console.error("n8n fetch failed", e);
    setN8nStatus("取得に失敗しました。URLを確認してください。");
    if (showToast) toast("取得に失敗しました");
  } finally {
    n8nFetchInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", initN8nSync);
