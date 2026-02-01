// app.js — TaskFlow (API + per-device user id + local cache + theme toggle)
// Requires backend routes at: /api/tasks and /api/tasks/:id
// Requires HTML ids: taskList, taskForm, titleInput, noteInput, doneCount, progressCount, totalCount
// Optional HTML id: themeToggle (button)

const API_URL = "/api/tasks";

// -------------------- DOM --------------------
const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");

const doneCountEl = document.getElementById("doneCount");
const progressCountEl = document.getElementById("progressCount");
const totalCountEl = document.getElementById("totalCount");

const themeToggleBtn = document.getElementById("themeToggle"); // optional

// -------------------- State --------------------
let allTasks = [];

// -------------------- Per-device User ID (sent in header) --------------------
const USER_KEY = "taskflow.userId.v1";

function getUserId() {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = "u_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

const USER_ID = getUserId();

// -------------------- Local cache (instant render after refresh) --------------------
const STORAGE_KEY = "taskflow.tasks.v1";
const UPDATED_KEY = "taskflow.lastUpdated.v1";

function loadLocalTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {}
}

function setLastUpdated(ts = Date.now()) {
  try {
    localStorage.setItem(UPDATED_KEY, String(ts));
  } catch {}
  renderLastUpdated();
}

function getLastUpdated() {
  const raw = localStorage.getItem(UPDATED_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

// -------------------- Theme (detect + persist) --------------------
const THEME_KEY = "taskflow.theme.v1"; // "light" | "dark"

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;

  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}

  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
  }
}

function setupTheme() {
  applyTheme(getPreferredTheme());

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  // If user hasn't set a theme, follow system changes
  const saved = localStorage.getItem(THEME_KEY);
  if (saved !== "light" && saved !== "dark") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", () => applyTheme(getPreferredTheme()));
    }
  }
}

// -------------------- API helper (ALWAYS sends X-User-Id) --------------------
async function apiFetch(path = "", options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": USER_ID,
      ...(options.headers || {})
    }
  });

  // helpful error surface
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${API_URL}${path} failed (${res.status}) ${text}`);
  }

  return res;
}

// -------------------- Utils --------------------
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeStatus(status) {
  if (status === "todo" || status === "progress" || status === "done") return status;
  return "todo";
}

function statusLabel(status) {
  if (status === "todo") return "To do";
  if (status === "progress") return "In progress";
  return "Done";
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// -------------------- UI: last updated line --------------------
function ensureLastUpdatedEl() {
  const app = document.querySelector(".app");
  if (!app) return null;

  let el = document.getElementById("lastUpdated");
  if (el) return el;

  el = document.createElement("p");
  el.id = "lastUpdated";
  el.className = "last-updated";

  const progressBar = document.getElementById("progressBar");
  if (progressBar) {
    progressBar.insertAdjacentElement("afterend", el);
  } else {
    app.insertBefore(el, app.children[2] || null);
  }
  return el;
}

function renderLastUpdated() {
  const el = ensureLastUpdatedEl();
  if (!el) return;
  el.textContent = `Last updated: ${formatTime(getLastUpdated())}`;
}

// -------------------- Counts --------------------
function updateProgressSummary() {
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const total = allTasks.length;

  if (doneCountEl) doneCountEl.textContent = done;
  if (progressCountEl) progressCountEl.textContent = progress;
  if (totalCountEl) totalCountEl.textContent = total;
}

// -------------------- Animations --------------------
function animateIn(li, i) {
  li.classList.add("task-anim");
  li.style.animationDelay = `${Math.min(i * 45, 240)}ms`;
}

// -------------------- Render --------------------
function render() {
  if (!list) return;
  list.innerHTML = "";

  if (!allTasks || allTasks.length === 0) {
    list.innerHTML = `
      <li class="empty">
        <strong>No tasks yet.</strong>
        <span>Add a task above to get started.</span>
      </li>
    `;
    return;
  }

  allTasks.forEach((task, i) => {
    const li = document.createElement("li");
    li.className = `task ${task.status}`;

    const noteAttr = task.note ? `data-note="${escapeHtml(task.note)}"` : "";

    li.innerHTML = `
      <div class="left">
        <span class="title" ${noteAttr}>${escapeHtml(task.title)}</span>
        <span class="badge">${statusLabel(task.status)}</span>
      </div>

      <div class="actions">
        <button class="btn" data-action="todo" title="Move to To do">◻</button>
        <button class="btn" data-action="progress" title="Start (In progress)">▶</button>
        <button class="btn" data-action="done" title="Mark done">✓</button>
        <button class="btn danger" data-action="delete" title="Delete">✕</button>
      </div>
    `;

    // Button events
    li.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");

        try {
          if (action === "delete") {
            await deleteTask(task.id);
            return;
          }

          await updateTask(task.id, { status: action });

          // subtle pulse on this task's badge
          const badge = li.querySelector(".badge");
          if (badge) {
            badge.classList.remove("pulse");
            void badge.offsetWidth;
            badge.classList.add("pulse");
          }
        } catch (err) {
          console.error(err);
          alert("Action failed. Check console for details.");
        }
      });
    });

    animateIn(li, i);
    list.appendChild(li);
  });
}

// -------------------- API Actions --------------------
async function fetchTasks() {
  const res = await apiFetch("", { method: "GET" });
  const data = await res.json();

  if (!Array.isArray(data)) return;

  const serverTasks = data.map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  // If server is empty but we have local tasks, don't wipe local
  if (serverTasks.length === 0 && allTasks.length > 0) return;

  allTasks = serverTasks;

  saveLocalTasks(allTasks);
  setLastUpdated(Date.now());

  render();
  updateProgressSummary();
}

async function createTask(title, note) {
  await apiFetch("", {
    method: "POST",
    body: JSON.stringify({ title, note })
  });

  setLastUpdated(Date.now());
  await fetchTasks();
}

async function updateTask(id, patch) {
  await apiFetch(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });

  setLastUpdated(Date.now());
  await fetchTasks();
}

async function deleteTask(id) {
  await apiFetch(`/${id}`, { method: "DELETE" });

  setLastUpdated(Date.now());
  await fetchTasks();
}

// -------------------- Events --------------------
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = (titleInput?.value || "").trim();
    const note = (noteInput?.value || "").trim();

    if (!title) return;

    try {
      await createTask(title, note);
      if (titleInput) titleInput.value = "";
      if (noteInput) noteInput.value = "";
    } catch (err) {
      console.error(err);
      alert("Add failed. Check console for details.");
    }
  });
}

// -------------------- Boot --------------------
function init() {
  setupTheme();

  // 1) show cached tasks immediately after refresh
  allTasks = loadLocalTasks().map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  render();
  updateProgressSummary();
  renderLastUpdated();

  // 2) then sync from server
  fetchTasks().catch(err => {
    console.warn("API sync failed, staying on local cache:", err);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
