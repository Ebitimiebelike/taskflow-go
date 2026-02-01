const API_URL = "/api/tasks";

// DOM
const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");

const doneCountEl = document.getElementById("doneCount");
const progressCountEl = document.getElementById("progressCount");
const totalCountEl = document.getElementById("totalCount");

// Debug (so you can confirm app.js actually loads)
console.log("TaskFlow app.js loaded ✅");

// -------------------- User ID --------------------
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

// -------------------- Local cache (instant on refresh) --------------------
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
  } catch {}
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

  // If request fails, show clear message in console
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${API_URL}${path} failed (${res.status}) ${text}`);
  }

  return res;
}

// -------------------- Helpers --------------------
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

// -------------------- State --------------------
let allTasks = [];

// -------------------- UI --------------------
function updateProgressSummary() {
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const total = allTasks.length;

  if (doneCountEl) doneCountEl.textContent = done;
  if (progressCountEl) progressCountEl.textContent = progress;
  if (totalCountEl) totalCountEl.textContent = total;
}

function render() {
  if (!list) return;
  list.innerHTML = "";

  if (!allTasks.length) {
    list.innerHTML = `
      <li class="empty">
        <strong>No tasks yet.</strong>
        <span>Add a task above to get started.</span>
      </li>
    `;
    return;
  }

  allTasks.forEach((task) => {
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

        try {
          if (action === "delete") {
            await deleteTask(task.id);
          } else {
            await updateTask(task.id, { status: action });
          }
        } catch (e) {
          console.error(e);
          alert("Action failed. Open console for details.");
        }
      });
    });

    list.appendChild(li);
  });
}

// -------------------- API actions --------------------
async function fetchTasks() {
  const res = await apiFetch("", { method: "GET" });
  const data = await res.json();

  const serverTasks = Array.isArray(data) ? data : [];

  allTasks = serverTasks.map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  // cache locally so refresh shows instantly
  saveLocalTasks(allTasks);

  render();
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
    } catch (e) {
      console.error(e);
      alert("Add failed. Open console for details.");
    }
  });
}

// -------------------- Boot --------------------
// 1) Load local tasks immediately (instant after refresh)
allTasks = loadLocalTasks().map(t => ({
  ...t,
  status: normalizeStatus(t.status),
  note: t.note || ""
}));

render();
updateProgressSummary();

// 2) Then sync from server
fetchTasks().catch(err => {
  console.warn("API fetch failed, staying on local cache:", err);
});
