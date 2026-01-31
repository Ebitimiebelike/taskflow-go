package main

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
)

type Task struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
}

var tasks []Task
var currentID int
var dataFile = "tasks.json"

func main() {
	// Load tasks on startup
	loadTasks()

	// API routes
	http.HandleFunc("/tasks", tasksHandler)
	http.HandleFunc("/tasks/", taskHandler)

	// Serve frontend
	fs := http.FileServer(http.Dir("Public"))

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		http.ServeFile(w, r, "Public/index.html")
		return
	}
	fs.ServeHTTP(w, r)
})


	// IMPORTANT: Use Railway/host port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server running on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

// Load tasks from JSON file
func loadTasks() {
	file, err := os.Open(dataFile)
	if err != nil {
		log.Println("tasks.json not found, starting fresh")
		tasks = []Task{}
		return
	}
	defer file.Close()

	data, err := ioutil.ReadAll(file)
	if err != nil {
		log.Fatal(err)
	}

	_ = json.Unmarshal(data, &tasks)

	// Update currentID
	currentID = 0
	for _, t := range tasks {
		if t.ID > currentID {
			currentID = t.ID
		}
	}
}

// Save tasks to JSON file
func saveTasks() {
	data, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		log.Println("Error saving tasks:", err)
		return
	}

	if err := ioutil.WriteFile(dataFile, data, 0644); err != nil {
		log.Println("Error writing tasks.json:", err)
	}
}

// Handler for /tasks (GET, POST)
func tasksHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(tasks)

	case "POST":
		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil || t.Title == "" {
			http.Error(w, "Invalid task data", http.StatusBadRequest)
			return
		}

		currentID++
		t.ID = currentID
		tasks = append(tasks, t)
		saveTasks()

		json.NewEncoder(w).Encode(t)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// Handler for /tasks/{id} (PUT, DELETE)
func taskHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	idStr := r.URL.Path[len("/tasks/"):]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", http.StatusBadRequest)
		return
	}

	index := -1
	for i, t := range tasks {
		if t.ID == id {
			index = i
			break
		}
	}
	if index == -1 {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case "PUT":
		tasks[index].Completed = !tasks[index].Completed
		saveTasks()
		json.NewEncoder(w).Encode(tasks[index])

	case "DELETE":
		tasks = append(tasks[:index], tasks[index+1:]...)
		saveTasks()
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}


