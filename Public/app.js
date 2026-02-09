console.log("TaskFlow app.js loaded ✅");

// ✅ Always use same origin as the page (prevents "wrong host" issues)
const API_URL = `${window.location.origin}/api/tasks`;

// DOM
const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");

const doneCountEl = document.getElementById("doneCount");
const progressCountEl = document.getElementById("progressCount");
const totalCountEl = document.getElementById("totalCount");

// Per-device User ID
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

// Local cache (instant refresh)
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

// ========= TIMER MANAGEMENT =========
// Store active timers: { taskId: { startTime, interval } }
const activeTimers = {};

function startTimer(taskId) {
  if (activeTimers[taskId]) {
    // Timer already running
    return;
  }

  const startTime = Date.now();
  
  // Update the timer display every second
  const interval = setInterval(() => {
    updateTimerDisplay(taskId, startTime);
  }, 1000);

  activeTimers[taskId] = { startTime, interval };
  
  // Initial update
  updateTimerDisplay(taskId, startTime);
}

function stopTimer(taskId) {
  const timer = activeTimers[taskId];
  if (!timer) return 0;

  clearInterval(timer.interval);
  const elapsed = Date.now() - timer.startTime;
  delete activeTimers[taskId];
  
  return elapsed;
}

function updateTimerDisplay(taskId, startTime) {
  const timerEl = document.querySelector(`[data-timer-id="${taskId}"]`);
  if (!timerEl) {
    // Timer element removed, stop the timer
    stopTimer(taskId);
    return;
  }

  const elapsed = Date.now() - startTime;
  timerEl.textContent = formatTime(elapsed);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  } else {
    return `0:${String(seconds).padStart(2, '0')}`;
  }
}

function formatTimeLong(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

function showTimePopup(taskTitle, timeSpent) {
  const overlay = document.createElement('div');
  overlay.className = 'time-popup-overlay';
  
  overlay.innerHTML = `
    <div class="time-popup">
      <h3>
        <span>🎉</span>
        <span>Task Completed!</span>
      </h3>
      <div class="task-title">${escapeHtml(taskTitle)}</div>
      <div class="time-spent">
        <div class="time-label">Time Spent</div>
        <div class="time-value">${formatTimeLong(timeSpent)}</div>
      </div>
      <button class="close-popup-btn">Awesome!</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on button click
  const closeBtn = overlay.querySelector('.close-popup-btn');
  closeBtn.addEventListener('click', () => {
    overlay.remove();
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

// ========= END TIMER MANAGEMENT =========

async function apiFetch(path = "", options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": USER_ID,
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${API_URL}${path} failed (${res.status}) ${text}`);
  }
  return res;
}

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

let allTasks = [];

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

  allTasks.forEach(task => {
    const li = document.createElement("li");
    li.className = `task ${task.status}`;

    const noteAttr = task.note ? `data-note="${escapeHtml(task.note)}"` : "";

    // Show timer if task is in progress
    const timerHtml = task.status === "progress" 
      ? `<span class="timer-display">
           <span class="timer-icon">⏱️</span>
           <span data-timer-id="${task.id}">0:00</span>
         </span>`
      : '';

    li.innerHTML = `
      <div class="left">
        <span class="title" ${noteAttr}>${escapeHtml(task.title)}</span>
        <span class="badge">${statusLabel(task.status)}</span>
        ${timerHtml}
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
            // Stop timer if running
            stopTimer(task.id);
            await apiFetch(`/${task.id}`, { method: "DELETE" });
          } else if (action === "progress") {
            // Start timer when moving to progress
            await apiFetch(`/${task.id}`, {
              method: "PUT",
              body: JSON.stringify({ status: action })
            });
            await fetchTasks();
            // Start timer after re-render
            setTimeout(() => startTimer(task.id), 100);
          } else if (action === "done") {
            // Stop timer and show popup
            const timeSpent = stopTimer(task.id);
            
            await apiFetch(`/${task.id}`, {
              method: "PUT",
              body: JSON.stringify({ status: action })
            });
            
            // Show popup with time spent if timer was running
            if (timeSpent > 0) {
              showTimePopup(task.title, timeSpent);
            }
            
            await fetchTasks();
          } else {
            // Moving to todo - stop timer if running
            stopTimer(task.id);
            await apiFetch(`/${task.id}`, {
              method: "PUT",
              body: JSON.stringify({ status: action })
            });
            await fetchTasks();
          }
        } catch (e) {
          console.error(e);
          alert("Action failed. Open console for details.");
        }
      });
    });

    list.appendChild(li);
  });

  // Restart timers for tasks that are in progress
  allTasks.forEach(task => {
    if (task.status === "progress" && !activeTimers[task.id]) {
      startTimer(task.id);
    }
  });
}

async function fetchTasks() {
  const res = await apiFetch("", { method: "GET" });
  const data = await res.json();

  const serverTasks = Array.isArray(data) ? data : [];
  allTasks = serverTasks.map(t => ({
    ...t,
    status: normalizeStatus(t.status),
    note: t.note || ""
  }));

  saveLocalTasks(allTasks);
  render();
  updateProgressSummary();
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = (titleInput?.value || "").trim();
    const note = (noteInput?.value || "").trim();
    if (!title) return;

    try {
      await apiFetch("", {
        method: "POST",
        body: JSON.stringify({ title, note })
      });
      if (titleInput) titleInput.value = "";
      if (noteInput) noteInput.value = "";
      await fetchTasks();
    } catch (e) {
      console.error(e);
      alert("Add failed. Open console for details.");
    }
  });
}

// ✅ Boot: show local instantly, then sync server
allTasks = loadLocalTasks().map(t => ({
  ...t,
  status: normalizeStatus(t.status),
  note: t.note || ""
}));
render();
updateProgressSummary();

fetchTasks().catch(err => {
  console.warn("API sync failed, staying on local cache:", err);
});

// Clean up timers on page unload
window.addEventListener('beforeunload', () => {
  Object.keys(activeTimers).forEach(taskId => {
    stopTimer(taskId);
  });
});