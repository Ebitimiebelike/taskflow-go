package main

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
)

type Task struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`           // "todo" | "progress" | "done"
	Note      string `json:"note,omitempty"`   // optional short note
	Completed bool   `json:"completed,omitempty"` // legacy support (optional)
}

type CreateTaskRequest struct {
	Title string `json:"title"`
	Note  string `json:"note"`
}

type UpdateTaskRequest struct {
	Title  *string `json:"title,omitempty"`
	Status *string `json:"status,omitempty"`
	Note   *string `json:"note,omitempty"`
}

var tasks []Task
var currentID int
var dataFile = "tasks.json"

func main() {
	loadTasks()

	http.HandleFunc("/tasks", tasksHandler)
	http.HandleFunc("/tasks/", taskHandler)

	// Serve frontend (Railway Linux: keep folder name consistent)
	http.Handle("/", http.FileServer(http.Dir("Public")))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server running on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func normalizeStatus(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "todo", "progress", "done":
		return s
	default:
		return ""
	}
}

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

	// currentID + migration: if Status missing, infer from legacy Completed
	currentID = 0
	changed := false
	for i := range tasks {
		if tasks[i].ID > currentID {
			currentID = tasks[i].ID
		}

		if normalizeStatus(tasks[i].Status) == "" {
			if tasks[i].Completed {
				tasks[i].Status = "done"
			} else {
				tasks[i].Status = "todo"
			}
			changed = true
		}
	}

	if changed {
		saveTasks()
	}
}

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

// /tasks (GET, POST)
func tasksHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(tasks)

	case "POST":
		var req CreateTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		title := strings.TrimSpace(req.Title)
		if title == "" {
			http.Error(w, "Title is required", http.StatusBadRequest)
			return
		}

		currentID++
		t := Task{
			ID:     currentID,
			Title:  title,
			Status: "todo",
			Note:   strings.TrimSpace(req.Note),
		}

		tasks = append(tasks, t)
		saveTasks()
		json.NewEncoder(w).Encode(t)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// /tasks/{id} (PUT, DELETE, GET optional)
func taskHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	idStr := strings.TrimPrefix(r.URL.Path, "/tasks/")
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
	case "GET":
		json.NewEncoder(w).Encode(tasks[index])

	case "PUT":
		var req UpdateTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		if req.Title != nil {
			title := strings.TrimSpace(*req.Title)
			if title == "" {
				http.Error(w, "Title cannot be empty", http.StatusBadRequest)
				return
			}
			tasks[index].Title = title
		}

		if req.Note != nil {
			tasks[index].Note = strings.TrimSpace(*req.Note)
		}

		if req.Status != nil {
			s := normalizeStatus(*req.Status)
			if s == "" {
				http.Error(w, "Invalid status. Use todo|progress|done", http.StatusBadRequest)
				return
			}
			tasks[index].Status = s
			tasks[index].Completed = (s == "done") // keep legacy consistent
		}

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
