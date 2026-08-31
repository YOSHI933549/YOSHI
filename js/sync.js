/* ==========================================================================
   Google Drive 経由の端末間同期(任意機能)
   ==========================================================================
   仕組み:
   - Google Identity Services (GIS) でユーザー本人のGoogleアカウントにログイン
   - Google Driveの「アプリ専用フォルダ」(appDataFolder)に state をJSONで
     1ファイルだけ保存・読み込み(このアプリ以外からは見えない領域)
   - 保存のたびに state.updatedAt を更新し、同期のたびに新しい方(last write
     wins)を採用する単純な方式。複雑なマージは行わない

   セットアップ(README参照):
   1. Google Cloud ConsoleでOAuthクライアントID(ウェブアプリケーション)を作成
   2. 下の GOOGLE_CLIENT_ID を発行されたIDに置き換える
   これが完了するまでは「同期機能は準備中です」と表示され、他の機能には
   一切影響しません。
   ========================================================================== */

const GOOGLE_CLIENT_ID = "805113385533-ks36kpm1tmt33akakll4rs3umle2ck80.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_NAME = "yoshi-health-tracker-state.json";
const SYNC_ENABLED_KEY = "yoshi-sync-enabled";
const SYNC_CONFIGURED = !GOOGLE_CLIENT_ID.startsWith("REPLACE_WITH_");

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let driveFileId = null;
let syncInFlight = false;
let pushTimer = null;

function syncEls() {
  return {
    notConfigured: document.getElementById("syncNotConfigured"),
    loadFailed: document.getElementById("syncLoadFailed"),
    signedOut: document.getElementById("syncSignedOut"),
    signedIn: document.getElementById("syncSignedIn"),
    statusText: document.getElementById("syncStatusText"),
  };
}

// Every render starts by hiding all four sync-card states, then shows
// exactly one — so a failure mode (like GIS not loading) can never leave
// the card silently empty.
function renderSyncUI(statusOverride) {
  const els = syncEls();
  if (!els.notConfigured) return; // settings panel not in DOM yet
  els.notConfigured.classList.add("hidden");
  els.loadFailed.classList.add("hidden");
  els.signedOut.classList.add("hidden");
  els.signedIn.classList.add("hidden");

  if (!SYNC_CONFIGURED) {
    els.notConfigured.classList.remove("hidden");
    return;
  }
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    els.loadFailed.classList.remove("hidden");
    return;
  }
  const signedIn = !!accessToken;
  if (signedIn) {
    els.signedIn.classList.remove("hidden");
    els.statusText.textContent = statusOverride || `最終同期: ${nowTimeStr()}`;
  } else {
    els.signedOut.classList.remove("hidden");
  }
}

function initSync() {
  if (!SYNC_CONFIGURED) {
    renderSyncUI();
    return;
  }

  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    // The GIS script (loaded from accounts.google.com) may not be ready yet,
    // or could be blocked by an ad/tracker blocker — retry briefly, then
    // give up quietly (the rest of the app works fine without it).
    if (initSync._retries === undefined) initSync._retries = 0;
    if (initSync._retries++ < 20) {
      setTimeout(initSync, 250);
    } else {
      console.warn("Google Identity Services did not load; sync unavailable.");
      renderSyncUI();
    }
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {}, // overridden per-call in ensureToken()/signIn()
  });

  const signInBtn = document.getElementById("syncSignInBtn");
  const nowBtn = document.getElementById("syncNowBtn");
  const signOutBtn = document.getElementById("syncSignOutBtn");
  if (signInBtn) signInBtn.addEventListener("click", signIn);
  if (nowBtn) nowBtn.addEventListener("click", () => syncNow(true));
  if (signOutBtn) signOutBtn.addEventListener("click", signOutSync);

  renderSyncUI();

  // Resume a previous session automatically where possible, and — this is
  // the important part — immediately pull whatever the other device last
  // saved, so opening the app shows current data right away instead of
  // waiting for the 60s interval or the next local edit. This needs a live
  // Google session + prior consent; browsers that block silent third-party
  // auth (notably Safari/iOS) may simply do nothing here, and the user can
  // still tap "ログイン"/「今すぐ同期」manually in that case.
  if (localStorage.getItem(SYNC_ENABLED_KEY) === "1") {
    try {
      tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp, { silent: true })) syncNow();
        renderSyncUI();
      };
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (e) {
      // ignore — falls back to manual sign-in
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  setInterval(() => syncNow(), 60000);
}

function handleTokenResponse(resp, { silent } = {}) {
  if (resp.error) {
    if (!silent) toast("Googleログインに失敗しました");
    return false;
  }
  accessToken = resp.access_token;
  tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
  localStorage.setItem(SYNC_ENABLED_KEY, "1");
  return true;
}

function signIn() {
  tokenClient.callback = (resp) => {
    if (handleTokenResponse(resp)) syncNow(true);
    renderSyncUI();
  };
  tokenClient.requestAccessToken({ prompt: "consent" });
}

function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return Promise.resolve(true);
  return new Promise((resolve) => {
    tokenClient.callback = (resp) => resolve(handleTokenResponse(resp, { silent: true }));
    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (e) {
      resolve(false);
    }
  });
}

async function driveRequest(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options && options.headers), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${url}`);
  return res;
}

async function findDriveFileId() {
  const res = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=" +
      encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`)
  );
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

async function pullFromDrive(fileId) {
  const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

async function pushToDrive(fileId) {
  state.updatedAt = new Date().toISOString();
  const metadata = fileId ? { name: DRIVE_FILE_NAME } : { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };
  const boundary = "yoshi-sync-boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(state)}\r\n--${boundary}--`;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await driveRequest(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  return data.id;
}

async function syncNow(showToast) {
  if (!SYNC_CONFIGURED || syncInFlight) return;
  const ok = await ensureToken();
  if (!ok || !accessToken) {
    renderSyncUI();
    return;
  }
  syncInFlight = true;
  renderSyncUI("同期中...");
  try {
    if (!driveFileId) driveFileId = await findDriveFileId();

    if (!driveFileId) {
      driveFileId = await pushToDrive(null); // first sync from this account — seed Drive
    } else {
      const remote = await pullFromDrive(driveFileId);
      const remoteTime = remote && remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
      const localTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
      if (remoteTime > localTime) {
        state = { ...structuredClone(DEFAULT_STATE), ...remote };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
        if (showToast) toast("他の端末の記録を反映しました");
      } else if (localTime > remoteTime) {
        await pushToDrive(driveFileId);
      } else if (showToast) {
        toast("最新の状態です");
      }
    }
  } catch (e) {
    console.error("sync failed", e);
    if (showToast) toast("同期に失敗しました。電波状況を確認して「今すぐ同期」をもう一度試してください。");
  } finally {
    syncInFlight = false;
    renderSyncUI();
  }
}

function signOutSync() {
  if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  driveFileId = null;
  localStorage.removeItem(SYNC_ENABLED_KEY);
  renderSyncUI();
  toast("ログアウトしました");
}

function scheduleSyncPush() {
  if (!SYNC_CONFIGURED || !accessToken) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), 1500);
}

document.addEventListener("DOMContentLoaded", initSync);
