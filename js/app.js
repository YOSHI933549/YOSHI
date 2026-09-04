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
let trendRange = "30"; // "7" | "30" | "90" | "all"

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
    // js/sync.js defines this when Google Drive sync is configured & signed in.
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
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

// Format a Date object as a local YYYY-MM-DD string (no UTC conversion —
// unlike todayStr(), this is meant for dates already constructed in local time).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  if (tab === "trends") renderTrends();
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

  // 材料を複数選んで「＋ 材料に追加」で積み上げ、合計をカロリー・PFC欄に自動反映する
  const foodPreset = document.getElementById("mealFoodPreset");
  const foodGrams = document.getElementById("mealFoodGrams");
  const foodGramsField = document.getElementById("mealFoodGramsField");
  const foodGramsLabel = document.getElementById("mealFoodGramsLabel");
  const foodServingsField = document.getElementById("mealFoodServingsField");
  const foodServingsBtns = document.getElementById("mealFoodServings");
  const foodAddBtn = document.getElementById("mealFoodAddBtn");
  const foodChips = document.getElementById("mealFoodChips");
  const foodHint = document.getElementById("mealFoodHint");
  const nameInput = document.getElementById("mealName");
  const caloriesInput = document.getElementById("mealCalories");
  const proteinInput = document.getElementById("mealProtein");
  const fatInput = document.getElementById("mealFat");
  const carbsInput = document.getElementById("mealCarbs");

  let ingredients = []; // [{name, qty, unitLabel, kcal, protein, fat, carbs}]
  let lastAutoName = ""; // メニュー名を自動入力した内容を覚えておき、ユーザーが手動で書き換えていなければ更新し続ける

  // プロテインなど「毎回決まった量(例: 15g/30g)しか使わない」食品は、
  // data-servings で指定された量だけをボタンで選ばせ、自由なg数入力をさせない。
  // 食パンなど「g数ではなく枚数・個数で数える」食品は data-unit="count" +
  // data-unit-label(例: 枚)を持たせ、入力欄のラベル・単位を切り替える
  // (g数の代わりに枚数を入力し、100gあたりではなく1枚あたりの値で計算する)
  function updateFoodInputMode() {
    const opt = foodPreset.selectedOptions[0];
    const servings = opt && opt.dataset.servings ? opt.dataset.servings.split(",").map(Number) : null;
    const unitLabel = (opt && opt.dataset.unitLabel) || "g";
    foodGrams.value = "";
    if (servings) {
      foodGramsField.classList.add("hidden");
      foodServingsField.classList.remove("hidden");
      foodServingsBtns.innerHTML = servings
        .map((g) => `<button type="button" class="serving-btn" data-g="${g}">${g}${unitLabel}</button>`)
        .join("");
    } else {
      foodGramsField.classList.remove("hidden");
      foodServingsField.classList.add("hidden");
      foodServingsBtns.innerHTML = "";
      const isCount = opt && opt.dataset.unit === "count";
      foodGramsLabel.textContent = isCount ? `${unitLabel}数` : "g数";
      foodGrams.placeholder = isCount ? "例: 1" : "例: 100";
    }
  }

  foodPreset.addEventListener("change", updateFoodInputMode);

  foodServingsBtns.addEventListener("click", (e) => {
    const btn = e.target.closest(".serving-btn");
    if (!btn) return;
    foodGrams.value = btn.dataset.g;
    foodServingsBtns.querySelectorAll(".serving-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });

  function renderFoodChips() {
    foodChips.classList.toggle("hidden", ingredients.length === 0);
    foodChips.innerHTML = ingredients
      .map(
        (ing, i) =>
          `<span class="food-chip">${escapeHTML(ing.name)} ${ing.qty}${ing.unitLabel}<button type="button" data-i="${i}" title="削除">✕</button></span>`
      )
      .join("");
  }

  function recalcFromIngredients() {
    if (ingredients.length === 0) {
      foodHint.hidden = true;
      return;
    }
    const totals = ingredients.reduce(
      (sum, ing) => ({
        kcal: sum.kcal + ing.kcal,
        protein: sum.protein + ing.protein,
        fat: sum.fat + ing.fat,
        carbs: sum.carbs + ing.carbs,
      }),
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );
    const kcal = Math.round(totals.kcal);
    const protein = Math.round(totals.protein * 10) / 10;
    const fat = Math.round(totals.fat * 10) / 10;
    const carbs = Math.round(totals.carbs * 10) / 10;
    caloriesInput.value = kcal;
    proteinInput.value = protein;
    fatInput.value = fat;
    carbsInput.value = carbs;
    const autoName = ingredients.map((ing) => `${ing.name}${ing.qty}${ing.unitLabel}`).join(" + ");
    if (!nameInput.value.trim() || nameInput.value === lastAutoName) nameInput.value = autoName;
    lastAutoName = autoName;
    foodHint.hidden = false;
    foodHint.textContent = `材料${ingredients.length}点の合計 → ${kcal}kcal / P${protein}g / F${fat}g / C${carbs}g(下の欄で微調整できます)`;
  }

  foodAddBtn.addEventListener("click", () => {
    const opt = foodPreset.selectedOptions[0];
    const qty = Number(foodGrams.value);
    if (!opt || !opt.value) {
      toast("食品を選択してください");
      return;
    }
    if (!qty) {
      toast(opt.dataset.unit === "count" ? `${opt.dataset.unitLabel || ""}数を入力してください` : "g数を入力してください");
      return;
    }
    // g数で数える食品は100gあたり、個数・枚数などで数える食品は1個(1枚)あたりの
    // データを保持しているので、それぞれ ÷100 / ÷1 で倍率を出す
    const unitLabel = opt.dataset.unit === "count" ? opt.dataset.unitLabel || "個" : "g";
    const ratio = opt.dataset.unit === "count" ? qty : qty / 100;
    ingredients.push({
      name: opt.value,
      qty,
      unitLabel,
      kcal: Number(opt.dataset.kcal) * ratio,
      protein: Number(opt.dataset.protein) * ratio,
      fat: Number(opt.dataset.fat) * ratio,
      carbs: Number(opt.dataset.carbs) * ratio,
    });
    renderFoodChips();
    recalcFromIngredients();
    foodPreset.value = "";
    updateFoodInputMode();
  });

  foodChips.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    ingredients.splice(Number(btn.dataset.i), 1);
    renderFoodChips();
    recalcFromIngredients();
  });

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
    ingredients = [];
    lastAutoName = "";
    renderFoodChips();
    updateFoodInputMode();
    foodHint.hidden = true;
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

  const setCountGroup = document.getElementById("setCountGroup");
  const setRepsInput = document.getElementById("setReps");
  const setWeightInput = document.getElementById("setWeight");
  let setCount = 3;

  setCountGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    setCount = Number(btn.dataset.count);
    setCountGroup.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });

  const exerciseSelect = document.getElementById("exerciseSelect");
  const customField = document.getElementById("exerciseCustomField");
  const customInput = document.getElementById("exerciseCustomName");

  exerciseSelect.addEventListener("change", () => {
    const isCustom = exerciseSelect.value === "__custom__";
    customField.classList.toggle("hidden", !isCustom);
    if (isCustom) customInput.focus();
  });

  initExercisePicker(exerciseSelect);

  document.getElementById("workoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const reps = Number(setRepsInput.value) || 0;
    const weight = Number(setWeightInput.value) || 0;
    // 全セット共通の回数・重量を、選んだセット数ぶん複製する
    const sets = reps > 0 || weight > 0 ? Array.from({ length: setCount }, () => ({ reps, weight })) : [];

    const name =
      exerciseSelect.value === "__custom__" ? customInput.value.trim() : exerciseSelect.value;

    const workout = {
      id: uid(),
      date: dateInput.value || todayStr(),
      name,
      sets,
      memo: document.getElementById("workoutMemo").value.trim(),
    };
    if (!workout.name) {
      if (exerciseSelect.value === "__custom__") customInput.focus();
      return;
    }
    state.workouts.push(workout);
    saveState();
    e.target.reset();
    customField.classList.add("hidden");
    exerciseSelect.dispatchEvent(new Event("change")); // 種目ピッカーの表示(アイコン・名前)を先頭の種目に戻す
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

// 種目名の横に小さい絵(線画アイコン)をつけた一覧から種目を選べるようにする。
// 種目リストの実体は index.html の <select id="exerciseSelect"> のまま(隠して残す)にして、
// そこから読み取って見た目だけを作る。値の保存や他の処理は今まで通り exerciseSelect(隠しselect)が担当する。
function initExercisePicker(nativeSelect) {
  const picker = document.getElementById("exercisePicker");
  const btn = document.getElementById("exercisePickerBtn");
  const btnIcon = document.getElementById("exercisePickerIcon");
  const btnLabel = document.getElementById("exercisePickerLabel");
  const panel = document.getElementById("exercisePickerPanel");
  if (!picker || !btn || !panel) return;

  const iconFor = (value) =>
    (value === "__custom__" ? window.EXERCISE_ICON_CUSTOM : window.EXERCISE_ICONS && window.EXERCISE_ICONS[value]) ||
    "";

  let panelHTML = "";
  Array.from(nativeSelect.children).forEach((node) => {
    if (node.tagName === "OPTGROUP") {
      panelHTML += `<div class="exercise-group-label">${escapeHTML(node.label)}</div>`;
      Array.from(node.children).forEach((opt) => (panelHTML += exerciseOptionHTML(opt)));
    } else if (node.tagName === "OPTION") {
      panelHTML += exerciseOptionHTML(node);
    }
  });
  panel.innerHTML = panelHTML;

  function exerciseOptionHTML(opt) {
    const isCustom = opt.value === "__custom__";
    return `
    <button type="button" class="exercise-option${isCustom ? " is-custom" : ""}" data-value="${escapeHTML(opt.value)}">
      <span class="exercise-option-icon">${iconFor(opt.value)}</span>
      <span class="exercise-option-label">${escapeHTML(opt.textContent)}</span>
    </button>`;
  }

  function syncButtonFromSelect() {
    const opt = nativeSelect.selectedOptions[0];
    btnIcon.innerHTML = opt ? iconFor(opt.value) : "";
    btnLabel.textContent = opt ? opt.textContent : "種目を選択";
  }

  function openPanel() {
    panel.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    panel.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => {
    panel.classList.contains("hidden") ? openPanel() : closePanel();
  });

  panel.addEventListener("click", (e) => {
    const optBtn = e.target.closest(".exercise-option");
    if (!optBtn) return;
    nativeSelect.value = optBtn.dataset.value;
    nativeSelect.dispatchEvent(new Event("change"));
    closePanel();
  });

  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target)) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // 隠しselectの値が変わったら(一覧からのクリック・フォームリセットどちらでも)ボタン表示を追従させる
  nativeSelect.addEventListener("change", syncButtonFromSelect);
  syncButtonFromSelect();
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

  // 「現在」の体重はグラフ内の見出しボックスにも出るため、ここでは重複させない
  const parts = [
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
  // The intended on-screen height is captured once. Assigning `canvas.height`
  // below rewrites the height attribute to the device-pixel size, so re-reading
  // that attribute on a later re-draw would multiply the height by the device
  // pixel ratio again and again — on a 3x phone the chart grew taller every
  // time the dashboard re-rendered.
  if (!canvas.dataset.baseHeight) {
    canvas.dataset.baseHeight = String(Number(canvas.getAttribute("height")) || 140);
  }
  const cssHeight = Number(canvas.dataset.baseHeight);
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  // The stylesheet only sets `width: 100%`, so without an explicit CSS height
  // the element lays out at the device-pixel height (2-3x too tall).
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#1f7a5c";
  const muted = styles.getPropertyValue("--text-muted").trim() || "#888";
  const border = styles.getPropertyValue("--border").trim() || "#ddd";
  const text = styles.getPropertyValue("--text").trim() || "#1a2420";
  const surfaceAlt = styles.getPropertyValue("--surface-alt").trim() || "#eef3ee";
  const orange = styles.getPropertyValue("--accent-orange").trim() || "#e0793a";

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

  // Headline (current value + date) as a single compact line at the top-left.
  // A boxed callout used to sit here, but it plus its padding ate roughly half
  // of the canvas height, squeezing the line chart itself into the remainder.
  // Plain text keeps the "where am I now" answer while leaving the vertical
  // space to the part that actually shows the trend.
  const latest = windowed[windowed.length - 1];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = text;
  ctx.font = "bold 15px sans-serif";
  const headline = `${latest.weight}kg`;
  ctx.fillText(headline, 8, 14);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = muted;
  ctx.fillText(fmtDate(latest.date), 8 + ctx.measureText(headline).width + 22, 14);

  const padL = 8;
  const padR = 36;
  const padT = 24;
  const padB = 20;
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

  // horizontal gridlines + y-axis labels on the right
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
    ctx.fillText(val.toFixed(1), cssWidth - padR + 6, yy + 3);
  }

  // dashed vertical gridlines + evenly-spaced date labels along the bottom
  const labelCount = Math.min(5, windowed.length);
  const labelIndices = [...new Set(
    Array.from({ length: labelCount }, (_, i) =>
      labelCount === 1 ? 0 : Math.round((i * (windowed.length - 1)) / (labelCount - 1))
    )
  )];
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = border;
  labelIndices.forEach((i) => {
    const px = x(i);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
  });
  ctx.restore();

  ctx.fillStyle = muted;
  ctx.font = "10px sans-serif";
  labelIndices.forEach((i, idx) => {
    const label = fmtDate(windowed[i].date);
    const w = ctx.measureText(label).width;
    let tx = x(i) - w / 2;
    if (idx === 0) tx = Math.max(tx, padL);
    if (idx === labelIndices.length - 1) tx = Math.min(tx, cssWidth - padR - w);
    ctx.fillText(label, tx, cssHeight - 4);
  });

  // target weight reference line
  if (targetWeight) {
    const ty = y(Number(targetWeight));
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

  // points — open circles (colored ring, light fill) rather than solid dots
  windowed.forEach((l, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(l.weight), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary;
    ctx.stroke();
  });
}

// -------------------------------------------------------------------------
// Trends (rule-based analysis over the recorded data)
// -------------------------------------------------------------------------
function initTrends() {
  document.getElementById("trendRangeGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    trendRange = btn.dataset.range;
    document
      .querySelectorAll("#trendRangeGroup .range-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderTrends();
  });
}

// Every calendar date string from the earliest record (or N days back) through today.
function trendPeriodDates(rangeKey) {
  const end = todayStr();
  let startStr;
  if (rangeKey === "all") {
    const allDates = [
      ...state.meals.map((m) => m.date),
      ...state.workouts.map((w) => w.date),
      ...state.weightLogs.map((l) => l.date),
    ];
    startStr = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : end;
  } else {
    const d = new Date(end + "T00:00:00");
    d.setDate(d.getDate() - (Number(rangeKey) - 1));
    startStr = ymd(d);
  }
  const dates = [];
  const cur = new Date(startStr + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (cur <= endD) {
    dates.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function computeTrendMetrics(rangeKey) {
  const dates = trendPeriodDates(rangeKey);

  let loggedMealDays = 0;
  let workoutDays = 0;
  let sumTargetCal = 0;
  let sumActualCal = 0;
  let sumTargetProtein = 0;
  let sumActualProtein = 0;
  let targetedDays = 0;
  const weeklyBuckets = []; // [{label, pct}] averaged protein % per 7-day chunk

  let bucketSumPct = 0;
  let bucketCount = 0;
  let bucketStart = dates[0];

  dates.forEach((date, i) => {
    const dayMeals = state.meals.filter((m) => m.date === date);
    const hasMeal = dayMeals.length > 0;
    if (hasMeal) loggedMealDays++;
    if (state.workouts.some((w) => w.date === date)) workoutDays++;

    const totalCal = dayMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    const totalProtein = dayMeals.reduce((s, m) => s + (Number(m.protein) || 0), 0);

    const weightEntry = getWeightAsOf(date);
    const targets = state.profile && weightEntry ? computeTargets(state.profile, weightEntry.weight) : null;

    if (targets && hasMeal) {
      targetedDays++;
      sumTargetCal += targets.calories;
      sumActualCal += totalCal;
      sumTargetProtein += targets.protein;
      sumActualProtein += totalProtein;

      bucketSumPct += (totalProtein / targets.protein) * 100;
      bucketCount++;
    }

    const isWeekEnd = (i + 1) % 7 === 0 || i === dates.length - 1;
    if (isWeekEnd) {
      if (bucketCount > 0) {
        weeklyBuckets.push({ label: `${fmtDate(bucketStart)}〜${fmtDate(date)}`, pct: Math.round(bucketSumPct / bucketCount) });
      }
      bucketSumPct = 0;
      bucketCount = 0;
      bucketStart = dates[i + 1];
    }
  });

  const avgCaloriePct = targetedDays > 0 ? Math.round((sumActualCal / sumTargetCal) * 100) : null;
  const avgProteinPct = targetedDays > 0 ? Math.round((sumActualProtein / sumTargetProtein) * 100) : null;
  const avgCalDiff = targetedDays > 0 ? Math.round(sumTargetCal / targetedDays - sumActualCal / targetedDays) : null;
  const avgProteinDiff =
    targetedDays > 0 ? Math.round(sumTargetProtein / targetedDays - sumActualProtein / targetedDays) : null;

  // Weight pace: kg/week between the first and last weigh-in inside the period.
  const periodWeights = state.weightLogs
    .filter((l) => l.date >= dates[0] && l.date <= dates[dates.length - 1])
    .sort((a, b) => a.date.localeCompare(b.date));
  let weeklyRate = null;
  if (periodWeights.length >= 2) {
    const first = periodWeights[0];
    const last = periodWeights[periodWeights.length - 1];
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    if (days > 0) weeklyRate = +(((last.weight - first.weight) / days) * 7).toFixed(2);
  }

  return {
    totalDays: dates.length,
    loggedMealDays,
    workoutDays,
    avgCaloriePct,
    avgProteinPct,
    avgCalDiff,
    avgProteinDiff,
    weeklyRate,
    weeklyBuckets,
    hasAnyData: loggedMealDays > 0 || workoutDays > 0 || periodWeights.length > 0,
  };
}

function generateInsights(m) {
  const insights = [];

  if (m.totalDays > 0 && m.loggedMealDays / m.totalDays < 0.5) {
    insights.push({
      tone: "info",
      text: `食事の記録日数が${m.loggedMealDays}/${m.totalDays}日と少なめです。記録が増えるほど、この傾向分析の精度も上がります。`,
    });
  }

  if (m.avgCaloriePct !== null) {
    if (m.avgCaloriePct < 90) {
      insights.push({
        tone: "warning",
        text: `平均カロリー摂取が目標の${m.avgCaloriePct}%です。体重を増やすには、あと1日${m.avgCalDiff}kcalほど意識して増やすとペースが安定しそうです。`,
      });
    } else if (m.avgCaloriePct <= 115) {
      insights.push({ tone: "good", text: `カロリー摂取は目標にほぼ沿えています(平均${m.avgCaloriePct}%)。このペースを継続しましょう。` });
    } else {
      insights.push({
        tone: "warning",
        text: `平均カロリーが目標を大きく超えています(平均${m.avgCaloriePct}%)。増量ペースが早すぎると体脂肪の増加が大きくなりやすいので、少し抑えるのも一案です。`,
      });
    }
  }

  if (m.avgProteinPct !== null) {
    if (m.avgProteinPct < 90) {
      insights.push({
        tone: "warning",
        text: `たんぱく質摂取が目標(体重×2g)の${m.avgProteinPct}%にとどまっています。あと1日${m.avgProteinDiff}gほど、プロテインや高たんぱく食品を追加してみましょう。`,
      });
    } else {
      insights.push({ tone: "good", text: `たんぱく質は目標をしっかり満たせています(平均${m.avgProteinPct}%)。` });
    }
  }

  if (m.weeklyRate !== null) {
    if (m.weeklyRate < 0.1) {
      insights.push({
        tone: "warning",
        text: `体重の増加ペースが週${m.weeklyRate >= 0 ? "+" : ""}${m.weeklyRate}kgとゆっくりです。増量を優先するなら、設定タブの「カロリー上乗せ」を少し増やすと良いかもしれません。`,
      });
    } else if (m.weeklyRate <= 0.5) {
      insights.push({ tone: "good", text: `体重は週+${m.weeklyRate}kgペースで増えています。筋肉中心で増量する良いペースです。` });
    } else {
      insights.push({
        tone: "warning",
        text: `体重が週+${m.weeklyRate}kgペースで急に増えています。体脂肪の増加が大きくなっている可能性があるので、カロリーの上乗せをやや抑えるのも一案です。`,
      });
    }
  } else if (m.totalDays > 7) {
    insights.push({ tone: "info", text: "この期間の体重記録が2件未満のため、増減ペースを計算できません。体重タブで定期的に記録してみましょう。" });
  }

  const expectedWorkoutDays = Math.round((m.totalDays / 7) * 2); // ~2x/week baseline
  if (m.totalDays >= 7) {
    if (m.workoutDays < expectedWorkoutDays) {
      insights.push({
        tone: "warning",
        text: `この期間のトレーニング日数は${m.workoutDays}日でした。筋肉量を増やすには週2〜3回を目安に継続すると効果が出やすいです。`,
      });
    } else {
      insights.push({ tone: "good", text: `トレーニングは${m.workoutDays}日実施できています。良いペースです。` });
    }
  }

  if (insights.length === 0) {
    insights.push({ tone: "info", text: "記録が増えると、ここに気づきが表示されます。" });
  }

  return insights;
}

function renderTrends() {
  const metrics = computeTrendMetrics(trendRange);
  const emptyEl = document.getElementById("trendsEmpty");
  const contentEl = document.getElementById("trendsContent");

  if (!metrics.hasAnyData) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const statsEl = document.getElementById("trendStats");
  const pct = (v) => (v === null ? "記録不足" : `${v}%`);
  statsEl.innerHTML = `
    <div class="ts-item"><div class="k">平均カロリー達成率</div><div class="v">${pct(metrics.avgCaloriePct)}</div></div>
    <div class="ts-item"><div class="k">平均たんぱく質達成率</div><div class="v">${pct(metrics.avgProteinPct)}</div></div>
    <div class="ts-item"><div class="k">体重ペース(週あたり)</div><div class="v">${metrics.weeklyRate === null ? "記録不足" : `${metrics.weeklyRate >= 0 ? "+" : ""}${metrics.weeklyRate}kg`}</div></div>
    <div class="ts-item"><div class="k">食事記録日数</div><div class="v">${metrics.loggedMealDays}/${metrics.totalDays}日</div></div>
    <div class="ts-item"><div class="k">トレーニング日数</div><div class="v">${metrics.workoutDays}/${metrics.totalDays}日</div></div>
  `;

  renderTrendChart("trendChart", metrics.weeklyBuckets);

  const insightsEl = document.getElementById("trendInsights");
  const icons = { good: "✅", warning: "⚠️", info: "💡" };
  insightsEl.innerHTML = generateInsights(metrics)
    .map((i) => `<div class="insight-item ${i.tone}"><span class="icon">${icons[i.tone]}</span><span>${escapeHTML(i.text)}</span></div>`)
    .join("");
}

function renderTrendChart(canvasId, buckets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const cssHeight = Number(canvas.getAttribute("height")) || 160;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#1f7a5c";
  const orange = styles.getPropertyValue("--accent-orange").trim() || "#e0793a";
  const muted = styles.getPropertyValue("--text-muted").trim() || "#888";
  const border = styles.getPropertyValue("--border").trim() || "#ddd";

  if (buckets.length === 0) {
    ctx.fillStyle = muted;
    ctx.font = "12px sans-serif";
    ctx.fillText("食事の記録が足りないため、週別グラフを表示できません。", 8, cssHeight / 2);
    return;
  }

  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  const maxVal = Math.max(120, ...buckets.map((b) => b.pct));
  const y = (v) => padT + plotH - (v / maxVal) * plotH;

  // gridlines
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.font = "10px sans-serif";
  ctx.lineWidth = 1;
  [0, 50, 100].forEach((v) => {
    if (v > maxVal) return;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(cssWidth - padR, yy);
    ctx.stroke();
    ctx.fillText(String(v), 2, yy + 3);
  });

  // 100% target dashed line
  ctx.save();
  ctx.strokeStyle = orange;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, y(100));
  ctx.lineTo(cssWidth - padR, y(100));
  ctx.stroke();
  ctx.restore();

  // bars
  const slot = plotW / buckets.length;
  const barW = Math.min(28, slot * 0.55);
  ctx.fillStyle = primary;
  buckets.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const barY = y(b.pct);
    ctx.fillRect(cx - barW / 2, barY, barW, padT + plotH - barY);
  });

  // x labels (first/last only to avoid crowding)
  ctx.fillStyle = muted;
  ctx.font = "10px sans-serif";
  const firstLabel = buckets[0].label;
  ctx.fillText(firstLabel, padL, cssHeight - 6);
  if (buckets.length > 1) {
    const lastLabel = buckets[buckets.length - 1].label;
    ctx.fillText(lastLabel, cssWidth - padR - ctx.measureText(lastLabel).width, cssHeight - 6);
  }
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
  document.getElementById("hardRefreshBtn").addEventListener("click", hardRefreshApp);
}

// Manual escape hatch for a stuck/stale cached version: unregister the
// service worker, clear every Cache Storage entry it made, then reload.
// Deliberately does NOT touch localStorage — the user's recorded data (and
// the yoshi-sync-enabled flag) survive this untouched.
async function hardRefreshApp() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("hard refresh cleanup failed", e);
  } finally {
    toast("更新しています...");
    location.reload();
  }
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
  renderTrends();
  renderSettings();
}

function init() {
  initTabs();
  initDashboard();
  initMeals();
  initWorkouts();
  initWeight();
  initTrends();
  initSettings();
  renderAll();
  window.addEventListener("resize", () => {
    renderWeightChart("weightChart", state.weightLogs, 30);
    const days = weightChartRange === "all" ? null : Number(weightChartRange);
    renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
    renderTrendChart("trendChart", computeTrendMetrics(trendRange).weeklyBuckets);
  });
}

document.addEventListener("DOMContentLoaded", init);

// Register the service worker so the app can be added to the home screen
// and keeps working offline (all data lives in localStorage already; this
// just caches the app shell itself). Safe to skip if unsupported (e.g. file://).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => reg.update().catch(() => {})) // check for a newer sw.js on every load
      .catch((err) => console.warn("Service worker registration failed:", err));

    // When a new service worker takes over (after an update), reload once so
    // the page picks up the latest index.html/js/css instead of staying on
    // whatever was loaded before the update. Guarded so it only fires once.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  });
}
