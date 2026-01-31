const API_URL = "/tasks";

const list = document.getElementById("taskList");
const form = document.getElementById("taskForm");
const input = document.getElementById("titleInput");

async function loadTasks() {
  const res = await fetch(API_URL);
  const tasks = await res.json();

  list.innerHTML = "";

  tasks.forEach(task => {
    const li = document.createElement("li");
    li.className = task.completed ? "completed" : "";

    li.innerHTML = `
      <span>${task.title}</span>
      <div>
        <button onclick="toggleTask(${task.id})">✓</button>
        <button onclick="deleteTask(${task.id})">✕</button>
      </div>
    `;

    list.appendChild(li);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.value.trim() })
  });

  input.value = "";
  loadTasks();
});

async function toggleTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "PUT" });
  loadTasks();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  loadTasks();
}

// Load tasks on page load
loadTasks();
