const API_URL = "/tasks";

// DOM
const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");

const doneCountEl = document.getElementById("doneCount");
const progressCountEl = document.getElementById("progressCount");
const totalCountEl = document.getElementById("totalCount");

const filterButtons = document.querySelectorAll("[data-filter]");
const focusToggle = document.getElementById("focusToggle");

// State
let allTasks = [];
let activeFilter = "all"; // all|todo|progress|done
let focusMode = false;

// --- User ID (per device, no login) ---
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

// --- Local cache ---
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

// --- API helper (always sends user id) ---
function apiFetch(path = "", options = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": USER_ID,
      ...(options.headers || {})
    }
  });
}

// --- Utils ---
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

function applyFilters(tasks) {
  if (focusMode) return tasks.filter(t => t.status === "progress");
  if (activeFilter === "all") return tasks;
  return tasks.filter(t => t.status === activeFilter);
}

// --- Progress Summary ---
function updateProgressSummary() {
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const total = allTasks.length;

  if (doneCountEl) doneCountEl.textContent = done;
  if (progressCountEl) progressCountEl.textContent = progress;
  if (totalCountEl) totalCountEl.textContent = total;
}

// --- Filter Counts ---
function updateFilterCounts() {
  const counts = {
    all: allTasks.length,
    todo: allTasks.filter(t => t.status === "todo").length,
    progress: allTasks.filter(t => t.status === "progress").length,
    done: allTasks.filter(t => t.status === "done").length,
  };

  filterButtons.forEach(btn => {
    const key = btn.getAttribute("data-filter");
    const baseText = btn.getAttribute("data-label") || btn.textContent.split(" (")[0];

    if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", baseText);
    btn.textContent = `${baseText} (${counts[key] ?? 0})`;
  });
}

// --- Last updated UI (injected under progress bar) ---
function ensureLastUpdatedEl() {
  // Place it near progress bar if possible, otherwise at top of app
  const app = document.querySelector(".app");
  if (!app) return null;

  let el = document.getElementById("lastUpdated");
  if (el) return el;

  el = document.createElement("p");
  el.id = "lastUpdated";
  el.className = "last-updated";

  // try to insert after progress bar
  const progressBar = document.getElementById("progressBar");
  if (progressBar && progressBar.parentElement) {
    progressBar.insertAdjacentElement("afterend", el);
  } else {
    app.insertBefore(el, app.children[2] || null);
  }

  return el;
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  // compact but readable
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderLastUpdated() {
  const el = ensureLastUpdatedEl();
  if (!el) return;
  const ts = getLastUpdated();
  el.textContent = `Last updated: ${formatTime(ts)}`;
}

// --- Soft animations ---
function animateIn(li, i) {
  li.classList.add("task-anim");
  li.style.animationDelay = `${Math.min(i * 45, 240)}ms`; // stagger, cap delay
}

// --- Render ---
function render() {
  const tasks = applyFilters(allTasks);
  list.innerHTML = "";

  if (tasks.length === 0) {
    const message = focusMode
      ? "No tasks in progress. Start one ▶ to use Focus Mode."
      : "Add a task above — then click ▶ to start working on it.";

    list.innerHTML = `
      <li class="empty">
        <strong>No tasks here.</strong>
        <span>${message}</span>
      </li>
    `;
    return;
  }

  tasks.forEach((task, i) => {
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

    li.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");

        if (action === "delete") {
          await deleteTask(task.id);
          return;
        }

        await updateTask(task.id, { status: action });
      });
    });

    animateIn(li, i);
    list.appendChild(li);
  });
}

// --- API actions ---
async function fetchTasks() {
  const res = await apiFetch("", { method: "GET" });
  const data = await res.json();

  if (!Array.isArray(data)) return;

  allTasks = data.map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  // sync local cache
  saveLocalTasks(allTasks);
  setLastUpdated(Date.now());

  render();
  updateFilterCounts();
  updateProgressSummary();
}

async function createTask(title, note) {
  await apiFetch("", {
    method: "POST",
    body: JSON.stringify({ title, note })
  });

  // Mark update immediately (UX feels snappy)
  setLastUpdated(Date.now());
  await fetchTasks();
}

async function updateTask(id, patch) {
  await apiFetch(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });

  setLastUpdated(Date.now());

  // Re-fetch tasks, then pulse the updated one
  await fetchTasks();

  // Pulse the badge of the updated task
  const updatedTaskEl = document.querySelector(`.task button[data-action="${patch.status}"]`)
    ?.closest(".task")
    ?.querySelector(".badge");

  if (updatedTaskEl) {
    updatedTaskEl.classList.remove("pulse"); // reset if exists
    void updatedTaskEl.offsetWidth;           // force reflow
    updatedTaskEl.classList.add("pulse");
  }
}


async function deleteTask(id) {
  await apiFetch(`/${id}`, { method: "DELETE" });

  setLastUpdated(Date.now());
  await fetchTasks();
}

// --- Events ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = titleInput.value.trim();
  const note = (noteInput?.value || "").trim();
  if (!title) return;

  await createTask(title, note);

  titleInput.value = "";
  if (noteInput) noteInput.value = "";
});

filterButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    activeFilter = btn.getAttribute("data-filter");
    filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

focusToggle.addEventListener("click", () => {
  focusMode = !focusMode;
  focusToggle.classList.toggle("active", focusMode);
  focusToggle.textContent = focusMode ? "Focus Mode: ON" : "Focus Mode";
  render();
});

// --- Boot: wait for DOM, show cached tasks immediately, then sync ---
document.addEventListener("DOMContentLoaded", () => {
  allTasks = loadLocalTasks().map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  render();
  updateFilterCounts();
  updateProgressSummary();
  renderLastUpdated();

  fetchTasks().catch(() => {
    // keep local tasks if API fails
  });
});

