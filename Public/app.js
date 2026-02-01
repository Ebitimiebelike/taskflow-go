const API_URL = "/tasks";

const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");
const doneCountEl = document.getElementById("doneCount");
const progressCountEl = document.getElementById("progressCount");
const totalCountEl = document.getElementById("totalCount");

const filterButtons = document.querySelectorAll("[data-filter]");
const focusToggle = document.getElementById("focusToggle");

let allTasks = [];
let activeFilter = "all"; // all|todo|progress|done
let focusMode = false;    // when true -> show only progress

const USER_KEY = "taskflow.userId.v1";

function getUserId() {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    // simple unique-ish id (good enough for no-auth demo)
    id = "u_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

const USER_ID = getUserId();

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


const STORAGE_KEY = "taskflow.tasks.v1";

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
  } catch {
    // If storage is full or blocked, fail silently
  }
}


function updateProgressSummary() {
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const total = allTasks.length;

  if (doneCountEl) doneCountEl.textContent = done;
  if (progressCountEl) progressCountEl.textContent = progress;
  if (totalCountEl) totalCountEl.textContent = total;
}


async function fetchTasks() {
  const res = await apiFetch("", { method: "GET" });
  const data = await res.json();
  allTasks = (Array.isArray(data) ? data : []).map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  render();
  updateFilterCounts();
  updateProgressSummary();
}

async function createTask(title, note) {
  await apiFetch("", {
    method: "POST",
    body: JSON.stringify({ title, note })
  });
  await fetchTasks();
}

async function updateTask(id, patch) {
  await apiFetch(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  await fetchTasks();
}

async function deleteTask(id) {
  await apiFetch(`/${id}`, { method: "DELETE" });
  await fetchTasks();
}


function normalizeStatus(status) {
  if (status === "todo" || status === "progress" || status === "done") return status;
  return "todo";
}

function applyFilters(tasks) {
  if (focusMode) return tasks.filter(t => t.status === "progress");
  if (activeFilter === "all") return tasks;
  return tasks.filter(t => t.status === activeFilter);
}

function statusLabel(status) {
  if (status === "todo") return "To do";
  if (status === "progress") return "In progress";
  return "Done";
}

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

    // store original label once
    if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", baseText);

    btn.textContent = `${baseText} (${counts[key] ?? 0})`;
  });
}

function render() {
  const tasks = applyFilters(allTasks);
  list.innerHTML = "";

  // ✅ Empty state
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

  tasks.forEach(task => {
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

    list.appendChild(li);
  });
}

async function createTask(title, note) {
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, note })
  });
  await fetchTasks();
}

async function updateTask(id, patch) {
  await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  await fetchTasks();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  await fetchTasks();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = titleInput.value.trim();
  const note = (noteInput?.value || "").trim();

  if (!title) return;

  await createTask(title, note);
  titleInput.value = "";
  if (noteInput) noteInput.value = "";
});

// Filters
filterButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    activeFilter = btn.getAttribute("data-filter");
    filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

// Focus mode
focusToggle.addEventListener("click", () => {
  focusMode = !focusMode;
  focusToggle.classList.toggle("active", focusMode);
  focusToggle.textContent = focusMode ? "Focus Mode: ON" : "Focus Mode";
  render();
});

// Helpers
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
// 1) Load cached tasks immediately (works offline + survives refresh)
allTasks = loadLocalTasks().map(t => ({
  ...t,
  status: normalizeStatus(t.status),
  note: t.note || ""
}));
render();
updateFilterCounts();
updateProgressSummary();

// 2) Then try to sync from API (if server has data)
fetchTasks().catch(() => {
  // If API fails, keep local tasks
});

