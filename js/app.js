/* ==========================================================================
   健康・筋トレ・増量トラッカー
   すべてのデータはブラウザの localStorage にのみ保存されます(サーバーなし)。
   ========================================================================== */

const STORAGE_KEY = "yoshi-health-tracker-v1";

/** @typedef {{height:number age:number gender:string activity:string targetWeight:number surplus:number fatRatio:number}} Profile */

const DEFAULT_STATE = {
  profile: null, // Profile | null
  weightLogs: [], // {id, date, weight}
  meals: [], // {id, date, time, type, name, calories, protein, fat, carbs, memo, photo}
  workouts: [], // {id, date, name, sets:[{reps, weight}], memo}
};

let state = loadState();
let weightChartRange = "all"; // "30" | "90" | "180" | "all"

// -------------------------------------------------------------------------
// Storage
// -------------------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch (e) {
    console.error("state load failed", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("state save failed", e);
    toast("保存に失敗しました(容量オーバーの可能性)。写真サイズを減らすか、古い記録を削除してください。");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// -------------------------------------------------------------------------
// Date helpers
// -------------------------------------------------------------------------
function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// -------------------------------------------------------------------------
// Tabs
// -------------------------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => switchTab(el.dataset.goto));
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  if (tab === "dashboard") renderDashboard();
  if (tab === "meals") renderMeals();
  if (tab === "workouts") renderWorkouts();
  if (tab === "weight") renderWeight();
  if (tab === "settings") renderSettings();
}

// -------------------------------------------------------------------------
// Nutrition target calculation
// -------------------------------------------------------------------------
function getWeightAsOf(dateStr) {
  const logs = [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date));
  if (logs.length === 0) return null;
  const upTo = logs.filter((l) => l.date <= dateStr);
  if (upTo.length > 0) return upTo[upTo.length - 1];
  return logs[0]; // fallback: earliest known if date is before any log
}

function getLatestWeight() {
  const logs = [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date));
  return logs.length ? logs[logs.length - 1] : null;
}

function computeTargets(profile, weightKg) {
  if (!profile || !weightKg) return null;
  const { height, age, gender, activity, surplus, fatRatio } = profile;
  const bmr =
    gender === "female"
      ? 10 * weightKg + 6.25 * height - 5 * age - 161
      : 10 * weightKg + 6.25 * height - 5 * age + 5;
  const tdee = bmr * Number(activity);
  const targetCalories = tdee + Number(surplus || 0);
  const proteinG = weightKg * 2;
  const proteinCal = proteinG * 4;
  const fatCal = targetCalories * (Number(fatRatio || 25) / 100);
  const fatG = fatCal / 9;
  const carbCal = Math.max(0, targetCalories - proteinCal - fatCal);
  const carbG = carbCal / 4;
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories: Math.round(targetCalories),
    protein: Math.round(proteinG),
    fat: Math.round(fatG),
    carb: Math.round(carbG),
  };
}

// -------------------------------------------------------------------------
// Dashboard
// -------------------------------------------------------------------------
function initDashboard() {
  const dateInput = document.getElementById("dashboardDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderDashboard);
}

function renderDashboard() {
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  const notice = document.getElementById("noProfileNotice");
  const content = document.getElementById("dashboardContent");

  const weightEntry = getWeightAsOf(dateStr);
  const targets = state.profile && weightEntry ? computeTargets(state.profile, weightEntry.weight) : null;

  if (!targets) {
    notice.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  notice.classList.add("hidden");
  content.classList.remove("hidden");

  const dayMeals = state.meals.filter((m) => m.date === dateStr);
  const totals = dayMeals.reduce(
    (acc, m) => {
      acc.calories += Number(m.calories) || 0;
      acc.protein += Number(m.protein) || 0;
      acc.fat += Number(m.fat) || 0;
      acc.carbs += Number(m.carbs) || 0;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  renderMacroCards(totals, targets);
  renderWeightChart("weightChart", state.weightLogs, 30);

  // Today's meals
  const mealsListEl = document.getElementById("todayMealsList");
  mealsListEl.innerHTML = dayMeals.length
    ? dayMeals.map((m) => mealItemHTML(m, false)).join("")
    : `<div class="empty-state">この日の食事記録はまだありません。「食事」タブから追加してください。</div>`;

  // Today's workouts
  const dayWorkouts = state.workouts.filter((w) => w.date === dateStr);
  const workoutListEl = document.getElementById("todayWorkoutList");
  workoutListEl.innerHTML = dayWorkouts.length
    ? dayWorkouts.map((w) => workoutItemHTML(w, false)).join("")
    : `<div class="empty-state">この日のトレーニング記録はまだありません。「筋トレ」タブから追加してください。</div>`;
}

function macroCardHTML(cls, label, value, target, unit) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = target > 0 && value > target;
  return `
  <div class="macro-card ${cls}">
    <div class="label"><span>${label}</span><span>${over ? "🔥 " : ""}${Math.round(value)}/${target}${unit}</span></div>
    <div class="value">${pct}<small>%</small></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function renderMacroCards(totals, targets) {
  const el = document.getElementById("macroCards");
  el.innerHTML =
    macroCardHTML("cal", "カロリー", totals.calories, targets.calories, "kcal") +
    macroCardHTML("protein", "たんぱく質", totals.protein, targets.protein, "g") +
    macroCardHTML("fat", "脂質", totals.fat, targets.fat, "g") +
    macroCardHTML("carb", "炭水化物", totals.carbs, targets.carb, "g");
}

// -------------------------------------------------------------------------
// Meals
// -------------------------------------------------------------------------
function initMeals() {
  const dateInput = document.getElementById("mealsDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderMeals);

  document.getElementById("mealTime").value = nowTimeStr();

  const photoInput = document.getElementById("mealPhoto");
  const preview = document.getElementById("mealPhotoPreview");
  let pendingPhoto = null;

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) {
      pendingPhoto = null;
      preview.classList.add("hidden");
      return;
    }
    try {
      pendingPhoto = await resizeImageToDataURL(file, 480, 0.7);
      preview.src = pendingPhoto;
      preview.classList.remove("hidden");
    } catch (e) {
      console.error(e);
      toast("写真の読み込みに失敗しました");
    }
  });

  document.getElementById("mealForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const meal = {
      id: uid(),
      date: dateInput.value || todayStr(),
      time: document.getElementById("mealTime").value || nowTimeStr(),
      type: document.getElementById("mealType").value,
      name: document.getElementById("mealName").value.trim(),
      calories: Number(document.getElementById("mealCalories").value) || 0,
      protein: Number(document.getElementById("mealProtein").value) || 0,
      fat: Number(document.getElementById("mealFat").value) || 0,
      carbs: Number(document.getElementById("mealCarbs").value) || 0,
      memo: document.getElementById("mealMemo").value.trim(),
      photo: pendingPhoto,
    };
    if (!meal.name) return;
    state.meals.push(meal);
    saveState();
    e.target.reset();
    document.getElementById("mealTime").value = nowTimeStr();
    pendingPhoto = null;
    preview.classList.add("hidden");
    renderMeals();
    toast("食事を記録しました");
  });

  document.getElementById("mealsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!confirm("この記録を削除しますか?")) return;
    state.meals = state.meals.filter((m) => m.id !== id);
    saveState();
    renderMeals();
  });
}

function mealItemHTML(m, withDelete = true) {
  const macros = `
    <span>🔥 ${m.calories}kcal</span>
    <span>P ${m.protein}g</span>
    ${m.fat ? `<span>F ${m.fat}g</span>` : ""}
    ${m.carbs ? `<span>C ${m.carbs}g</span>` : ""}`;
  return `
  <div class="list-item">
    ${m.photo ? `<img src="${m.photo}" alt="">` : ""}
    <div class="info">
      <div class="title-row">
        <span class="name">${escapeHTML(m.name)}</span>
        <span class="tag">${m.type}</span>
      </div>
      <div class="meta">${fmtDate(m.date)} ${m.time || ""}${m.memo ? " ・ " + escapeHTML(m.memo) : ""}</div>
      <div class="macros">${macros}</div>
    </div>
    ${withDelete ? `<button class="del" data-id="${m.id}" title="削除">✕</button>` : ""}
  </div>`;
}

function renderMeals() {
  const dateStr = document.getElementById("mealsDate").value || todayStr();
  const items = state.meals
    .filter((m) => m.date === dateStr)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const el = document.getElementById("mealsList");
  el.innerHTML = items.length
    ? items.map((m) => mealItemHTML(m, true)).join("")
    : `<div class="empty-state">この日の記録はまだありません。</div>`;
}

function resizeImageToDataURL(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// -------------------------------------------------------------------------
// Workouts
// -------------------------------------------------------------------------
function initWorkouts() {
  const dateInput = document.getElementById("workoutsDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderWorkouts);

  const setRows = document.getElementById("setRows");
  document.getElementById("addSetRow").addEventListener("click", () => addSetRow());
  addSetRow();
  addSetRow();

  document.getElementById("workoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const sets = [...setRows.querySelectorAll(".set-row")]
      .map((row) => ({
        reps: Number(row.querySelector(".set-reps").value) || 0,
        weight: Number(row.querySelector(".set-weight").value) || 0,
      }))
      .filter((s) => s.reps > 0 || s.weight > 0);

    const workout = {
      id: uid(),
      date: dateInput.value || todayStr(),
      name: document.getElementById("exerciseName").value.trim(),
      sets,
      memo: document.getElementById("workoutMemo").value.trim(),
    };
    if (!workout.name) return;
    state.workouts.push(workout);
    saveState();
    e.target.reset();
    setRows.innerHTML = "";
    addSetRow();
    addSetRow();
    renderWorkouts();
    toast("トレーニングを記録しました");
  });

  document.getElementById("workoutsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    if (!confirm("この記録を削除しますか?")) return;
    state.workouts = state.workouts.filter((w) => w.id !== btn.dataset.id);
    saveState();
    renderWorkouts();
  });
}

function addSetRow() {
  const setRows = document.getElementById("setRows");
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <input type="number" class="set-reps" placeholder="回数" min="0" step="1">
    <input type="number" class="set-weight" placeholder="重量(kg)" min="0" step="0.5">
    <button type="button" class="del-set" title="この行を削除">✕</button>`;
  row.querySelector(".del-set").addEventListener("click", () => row.remove());
  setRows.appendChild(row);
}

function workoutItemHTML(w, withDelete = true) {
  const setsText = w.sets.length
    ? w.sets.map((s) => `${s.reps}回${s.weight ? `×${s.weight}kg` : ""}`).join(" / ")
    : "セット未記録";
  return `
  <div class="list-item">
    <div class="info">
      <div class="title-row">
        <span class="name">${escapeHTML(w.name)}</span>
        <span class="tag">${w.sets.length}セット</span>
      </div>
      <div class="meta">${fmtDate(w.date)}${w.memo ? " ・ " + escapeHTML(w.memo) : ""}</div>
      <div class="macros"><span>${setsText}</span></div>
    </div>
    ${withDelete ? `<button class="del" data-id="${w.id}" title="削除">✕</button>` : ""}
  </div>`;
}

function renderWorkouts() {
  const dateStr = document.getElementById("workoutsDate").value || todayStr();
  const items = state.workouts.filter((w) => w.date === dateStr);
  const el = document.getElementById("workoutsList");
  el.innerHTML = items.length
    ? items.map((w) => workoutItemHTML(w, true)).join("")
    : `<div class="empty-state">この日の記録はまだありません。</div>`;
}

// -------------------------------------------------------------------------
// Weight
// -------------------------------------------------------------------------
function initWeight() {
  document.getElementById("weightDate").value = todayStr();

  document.getElementById("weightForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("weightDate").value || todayStr();
    const weight = Number(document.getElementById("weightValue").value);
    if (!weight) return;
    const existing = state.weightLogs.find((l) => l.date === date);
    if (existing) {
      existing.weight = weight;
    } else {
      state.weightLogs.push({ id: uid(), date, weight });
    }
    saveState();
    e.target.reset();
    document.getElementById("weightDate").value = todayStr();
    renderWeight();
    toast("体重を記録しました");
  });

  document.getElementById("weightList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    if (!confirm("この記録を削除しますか?")) return;
    state.weightLogs = state.weightLogs.filter((l) => l.id !== btn.dataset.id);
    saveState();
    renderWeight();
  });

  document.getElementById("weightRangeGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    weightChartRange = btn.dataset.range;
    document
      .querySelectorAll("#weightRangeGroup .range-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderWeight();
  });
}

function renderWeightTrend(logs) {
  const el = document.getElementById("weightTrend");
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    el.innerHTML = "";
    return;
  }
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const diff = +(latest.weight - first.weight).toFixed(1);
  const diffClass = diff > 0 ? "up" : diff < 0 ? "down" : "";
  const diffText = diff === 0 ? "±0kg" : diff > 0 ? `+${diff}kg` : `${diff}kg`;

  const parts = [
    `<span>現在 <b>${latest.weight}kg</b></span>`,
    `<span>記録開始 ${first.weight}kg(${fmtDate(first.date)})</span>`,
    `<span>増減 <b class="${diffClass}">${diffText}</b></span>`,
    `<span>記録数 ${sorted.length}件</span>`,
  ];

  const targetWeight = state.profile && state.profile.targetWeight;
  if (targetWeight) {
    const remain = +(targetWeight - latest.weight).toFixed(1);
    parts.push(
      `<span>目標 ${targetWeight}kg まで ${remain > 0 ? `あと ${remain}kg` : "達成 🎉"}</span>`
    );
  }

  el.innerHTML = parts.join("");
}

function renderWeight() {
  const sorted = [...state.weightLogs].sort((a, b) => b.date.localeCompare(a.date));
  const el = document.getElementById("weightList");
  el.innerHTML = sorted.length
    ? sorted
        .map((l, i) => {
          const prev = sorted[i + 1];
          const diff = prev ? +(l.weight - prev.weight).toFixed(1) : null;
          const diffText =
            diff === null ? "" : diff === 0 ? "±0" : diff > 0 ? `+${diff}kg` : `${diff}kg`;
          return `
        <div class="list-item">
          <div class="info">
            <div class="title-row">
              <span class="name">${l.weight}kg</span>
              <span class="tag">${fmtDate(l.date)}</span>
            </div>
            ${diffText ? `<div class="meta">前回比 ${diffText}</div>` : ""}
          </div>
          <button class="del" data-id="${l.id}" title="削除">✕</button>
        </div>`;
        })
        .join("")
    : `<div class="empty-state">まだ体重の記録がありません。</div>`;

  renderWeightTrend(state.weightLogs);
  const days = weightChartRange === "all" ? null : Number(weightChartRange);
  renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
}

function renderWeightChart(canvasId, logs, days, targetWeight) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  let windowed = sorted;
  if (days && sorted.length > 0) {
    const anchor = new Date(sorted[sorted.length - 1].date + "T00:00:00");
    anchor.setDate(anchor.getDate() - days);
    const cutoff = anchor.toISOString().slice(0, 10);
    windowed = sorted.filter((l) => l.date >= cutoff);
    if (windowed.length < 2 && sorted.length >= 2) windowed = sorted.slice(-2); // always show a line if 2+ records exist
  }
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const cssHeight = Number(canvas.getAttribute("height")) || 140;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#1f7a5c";
  const muted = styles.getPropertyValue("--text-muted").trim() || "#888";
  const border = styles.getPropertyValue("--border").trim() || "#ddd";

  if (windowed.length === 0) {
    ctx.fillStyle = muted;
    ctx.font = "12px sans-serif";
    ctx.fillText("体重の記録がありません", 8, cssHeight / 2);
    return;
  }
  if (windowed.length === 1) {
    ctx.fillStyle = muted;
    ctx.font = "12px sans-serif";
    ctx.fillText(`${windowed[0].weight}kg (${fmtDate(windowed[0].date)}) — 記録を増やすとグラフが表示されます`, 8, cssHeight / 2);
    return;
  }

  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 18;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  const weights = windowed.map((l) => l.weight);
  if (targetWeight) weights.push(Number(targetWeight));
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;

  const x = (i) => padL + (plotW * i) / (windowed.length - 1);
  const y = (w) => padT + plotH - ((w - min) / (max - min)) * plotH;

  // gridlines + labels
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.font = "10px sans-serif";
  ctx.lineWidth = 1;
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const val = min + ((max - min) * i) / gridLines;
    const yy = y(val);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(cssWidth - padR, yy);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), 2, yy + 3);
  }

  // date labels (first/last)
  ctx.fillText(fmtDate(windowed[0].date), padL, cssHeight - 4);
  const lastLabel = fmtDate(windowed[windowed.length - 1].date);
  ctx.fillText(lastLabel, cssWidth - padR - ctx.measureText(lastLabel).width, cssHeight - 4);

  // target weight reference line
  if (targetWeight) {
    const ty = y(Number(targetWeight));
    const orange = styles.getPropertyValue("--accent-orange").trim() || "#e0793a";
    ctx.save();
    ctx.strokeStyle = orange;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, ty);
    ctx.lineTo(cssWidth - padR, ty);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = orange;
    ctx.fillText(`目標 ${targetWeight}kg`, padL + 4, ty - 4);
  }

  // line
  ctx.beginPath();
  windowed.forEach((l, i) => {
    const px = x(i);
    const py = y(l.weight);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  // points
  ctx.fillStyle = primary;
  windowed.forEach((l, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(l.weight), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// -------------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------------
function initSettings() {
  document.getElementById("profileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.profile = {
      height: Number(document.getElementById("height").value),
      age: Number(document.getElementById("age").value),
      gender: document.getElementById("gender").value,
      activity: document.getElementById("activity").value,
      targetWeight: Number(document.getElementById("targetWeight").value) || null,
      surplus: Number(document.getElementById("surplus").value) || 0,
      fatRatio: Number(document.getElementById("fatRatio").value) || 25,
    };
    saveState();
    renderSettings();
    toast("プロフィールを保存しました");
  });

  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importInput").addEventListener("change", importData);
  document.getElementById("resetBtn").addEventListener("click", resetAllData);
}

function renderSettings() {
  const p = state.profile;
  if (p) {
    document.getElementById("height").value = p.height ?? "";
    document.getElementById("age").value = p.age ?? "";
    document.getElementById("gender").value = p.gender ?? "male";
    document.getElementById("activity").value = p.activity ?? "1.55";
    document.getElementById("targetWeight").value = p.targetWeight ?? "";
    document.getElementById("surplus").value = p.surplus ?? 400;
    document.getElementById("fatRatio").value = p.fatRatio ?? 25;
  }

  const summaryEl = document.getElementById("targetSummary");
  const latest = getLatestWeight();
  const targets = p && latest ? computeTargets(p, latest.weight) : null;

  if (!targets) {
    summaryEl.innerHTML = `<div class="empty-state">プロフィールと体重(「体重」タブ)を入力すると、ここに1日の目標が表示されます。</div>`;
    return;
  }

  summaryEl.innerHTML = `
    <div class="ts-item"><div class="k">基準体重</div><div class="v">${latest.weight}kg</div></div>
    <div class="ts-item"><div class="k">基礎代謝(BMR)</div><div class="v">${targets.bmr}kcal</div></div>
    <div class="ts-item"><div class="k">消費カロリー(TDEE)</div><div class="v">${targets.tdee}kcal</div></div>
    <div class="ts-item"><div class="k">摂取目標カロリー</div><div class="v">${targets.calories}kcal</div></div>
    <div class="ts-item"><div class="k">たんぱく質(体重×2)</div><div class="v">${targets.protein}g</div></div>
    <div class="ts-item"><div class="k">脂質</div><div class="v">${targets.fat}g</div></div>
    <div class="ts-item"><div class="k">炭水化物</div><div class="v">${targets.carb}g</div></div>
    ${p.targetWeight ? `<div class="ts-item"><div class="k">目標体重</div><div class="v">${p.targetWeight}kg</div></div>` : ""}
  `;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `health-tracker-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("エクスポートしました");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm("現在のデータを上書きしてインポートします。よろしいですか?")) return;
      state = { ...structuredClone(DEFAULT_STATE), ...data };
      saveState();
      renderAll();
      toast("インポートしました");
    } catch (err) {
      console.error(err);
      toast("インポートに失敗しました(ファイル形式を確認してください)");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

function resetAllData() {
  if (!confirm("すべての記録(食事・トレーニング・体重・プロフィール)を削除します。元に戻せません。よろしいですか?")) return;
  if (!confirm("本当によろしいですか? この操作は取り消せません。")) return;
  state = structuredClone(DEFAULT_STATE);
  saveState();
  renderAll();
  toast("すべてのデータを削除しました");
}

// -------------------------------------------------------------------------
// Toast
// -------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderWeight();
  renderSettings();
}

function init() {
  initTabs();
  initDashboard();
  initMeals();
  initWorkouts();
  initWeight();
  initSettings();
  renderAll();
  window.addEventListener("resize", () => {
    renderWeightChart("weightChart", state.weightLogs, 30);
    const days = weightChartRange === "all" ? null : Number(weightChartRange);
    renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
  });
}

document.addEventListener("DOMContentLoaded", init);
