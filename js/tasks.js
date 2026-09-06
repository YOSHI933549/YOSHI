/* ==========================================================================
   AI課題ダッシュボード
   ==========================================================================
   n8n の「司令塔エージェント」が書き込む課題台帳(データテーブル agent_tasks)を、
   読み取り専用のWebhook経由で取得して一覧表示するだけの画面です。
   登録・編集はここではできません(Slackや司令塔エージェントとの会話で行います)。
   ========================================================================== */

const TASKS_API_URL = "https://yoshi0418.app.n8n.cloud/webhook/yoshi-tasks-out";
const TASKS_API_TOKEN = "FfYzilnEUODqRpKEnng9qxi2LIbWb2w";

const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const STATUS_LABELS = {
  "not-started": "未着手",
  "in-progress": "進行中",
  done: "完了",
};
const ASSIGNEE_LABELS = {
  developer: "開発",
  chores: "雑務",
  research: "リサーチ",
};

let allTasks = [];
let activeStatusFilter = "all";

function labelFor(map, rawValue) {
  if (!rawValue) return "未設定";
  const key = String(rawValue).trim().toLowerCase();
  return map[key] || rawValue;
}

function statusClass(rawValue) {
  const key = String(rawValue || "").trim().toLowerCase();
  if (key === "done") return "status-done";
  if (key === "in-progress") return "status-in-progress";
  return "";
}

function priorityClass(rawValue) {
  const key = String(rawValue || "").trim().toLowerCase();
  if (key === "high") return "priority-high";
  if (key === "medium") return "priority-medium";
  return "priority-low";
}

function assigneeLabels(rawValue) {
  if (!rawValue) return ["未設定"];
  return String(rawValue)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => labelFor(ASSIGNEE_LABELS, s));
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function els() {
  return {
    refreshBtn: document.getElementById("refreshBtn"),
    lastUpdated: document.getElementById("lastUpdated"),
    statusFilters: document.getElementById("statusFilters"),
    taskList: document.getElementById("taskList"),
    taskListEmpty: document.getElementById("taskListEmpty"),
    taskListError: document.getElementById("taskListError"),
    taskListErrorText: document.getElementById("taskListErrorText"),
  };
}

function renderFilters() {
  const { statusFilters } = els();
  const options = [
    { key: "all", label: "すべて" },
    { key: "not-started", label: "未着手" },
    { key: "in-progress", label: "進行中" },
    { key: "done", label: "完了" },
  ];
  statusFilters.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "filter-chip" + (activeStatusFilter === opt.key ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      activeStatusFilter = opt.key;
      renderFilters();
      renderTasks();
    });
    statusFilters.appendChild(btn);
  });
}

function renderTasks() {
  const { taskList, taskListEmpty } = els();
  const filtered = allTasks
    .filter((t) => activeStatusFilter === "all" || String(t.status || "").toLowerCase() === activeStatusFilter)
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[String(a.priority || "").toLowerCase()] ?? 3;
      const pb = PRIORITY_ORDER[String(b.priority || "").toLowerCase()] ?? 3;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

  taskList.innerHTML = "";
  if (filtered.length === 0) {
    taskListEmpty.classList.remove("hidden");
    return;
  }
  taskListEmpty.classList.add("hidden");

  filtered.forEach((t) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.style.flexDirection = "column";
    item.style.alignItems = "stretch";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = t.title || "(タイトルなし)";
    titleRow.appendChild(nameEl);
    titleRow.appendChild(makeBadge(labelFor(PRIORITY_LABELS, t.priority), "priority-badge " + priorityClass(t.priority)));
    item.appendChild(titleRow);

    const badgeRow = document.createElement("div");
    badgeRow.className = "task-badges";
    badgeRow.appendChild(makeBadge(labelFor(STATUS_LABELS, t.status), "status-badge " + statusClass(t.status)));
    assigneeLabels(t.assignees).forEach((a) => {
      badgeRow.appendChild(makeBadge("👤 " + a, "assignee-chip"));
    });
    item.appendChild(badgeRow);

    if (t.description) {
      const desc = document.createElement("p");
      desc.className = "task-desc";
      desc.textContent = t.description;
      item.appendChild(desc);
    }

    if (t.result) {
      const result = document.createElement("div");
      result.className = "task-result";
      result.textContent = "📋 " + t.result;
      item.appendChild(result);
    }

    if (t.qualityCheck) {
      const check = document.createElement("div");
      check.className = "task-result task-check";
      check.textContent = "✅ 自己チェック: " + t.qualityCheck;
      item.appendChild(check);
    }

    if (t.nextAction) {
      const next = document.createElement("div");
      next.className = "task-result task-next";
      next.textContent = "👉 次に繋げる提案: " + t.nextAction;
      item.appendChild(next);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "更新: " + (formatDateTime(t.updatedAt) || "―");
    item.appendChild(meta);

    taskList.appendChild(item);
  });
}

function makeBadge(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

async function loadTasks() {
  const { refreshBtn, lastUpdated, taskListError, taskListErrorText } = els();
  refreshBtn.disabled = true;
  refreshBtn.textContent = "🔄 取得中…";
  taskListError.classList.add("hidden");

  try {
    const url = TASKS_API_URL + "?token=" + encodeURIComponent(TASKS_API_TOKEN);
    const res = await fetch(url);
    if (!res.ok) throw new Error("サーバーからの応答が正しくありません(" + res.status + ")");
    const data = await res.json();
    allTasks = Array.isArray(data) ? data : [];
    lastUpdated.textContent = "最終更新: " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    renderTasks();
  } catch (err) {
    taskListErrorText.textContent = "取得に失敗しました。しばらくしてからもう一度お試しください。(" + err.message + ")";
    taskListError.classList.remove("hidden");
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 更新";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderFilters();
  els().refreshBtn.addEventListener("click", loadTasks);
  loadTasks();
});
