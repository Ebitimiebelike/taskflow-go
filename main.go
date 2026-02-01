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
	ID     int    `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`         // "todo" | "progress" | "done"
	Note   string `json:"note,omitempty"` // optional
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

// New storage format: per-user tasks + per-user ID counters
type Store struct {
	TasksByUser     map[string][]Task `json:"tasksByUser"`
	CurrentIDByUser map[string]int    `json:"currentIdByUser"`
}

var dataFile = "tasks.json"
var store = Store{
	TasksByUser:     map[string][]Task{},
	CurrentIDByUser: map[string]int{},
}

func main() {
	loadStore()

	http.HandleFunc("/tasks", tasksHandler)
	http.HandleFunc("/tasks/", taskHandler)

	// Serve frontend (Railway Linux: your folder is "Public")
	http.Handle("/", http.FileServer(http.Dir("Public")))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server running on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func getUserID(r *http.Request) string {
	// Read from header first
	id := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if id == "" {
		// fallback: query param (optional)
		id = strings.TrimSpace(r.URL.Query().Get("userId"))
	}
	if id == "" {
		// If someone hits your API without id, group them into "guest"
		id = "guest"
	}
	return id
}

func normalizeStatus(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "todo", "progress", "done":
		return s
	default:
		return "todo"
	}
}

func loadStore() {
	file, err := os.Open(dataFile)
	if err != nil {
		log.Println("tasks.json not found, starting fresh")
		return
	}
	defer file.Close()

	data, err := ioutil.ReadAll(file)
	if err != nil {
		log.Fatal(err)
	}

	// Try new format
	var s Store
	if err := json.Unmarshal(data, &s); err == nil && s.TasksByUser != nil {
		store = s
		if store.TasksByUser == nil {
			store.TasksByUser = map[string][]Task{}
		}
		if store.CurrentIDByUser == nil {
			store.CurrentIDByUser = map[string]int{}
		}
		return
	}

	// Backward compatibility: old format []Task
	var old []Task
	if err := json.Unmarshal(data, &old); err == nil {
		store.TasksByUser["guest"] = old
		maxID := 0
		for i := range old {
			old[i].Status = normalizeStatus(old[i].Status)
			if old[i].ID > maxID {
				maxID = old[i].ID
			}
		}
		store.TasksByUser["guest"] = old
		store.CurrentIDByUser["guest"] = maxID
		saveStore()
		return
	}

	log.Println("Could not parse tasks.json; starting fresh")
}

func saveStore() {
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		log.Println("Error saving store:", err)
		return
	}
	if err := ioutil.WriteFile(dataFile, data, 0644); err != nil {
		log.Println("Error writing tasks.json:", err)
	}
}

func tasksHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID := getUserID(r)

	if _, ok := store.TasksByUser[userID]; !ok {
		store.TasksByUser[userID] = []Task{}
	}
	if _, ok := store.CurrentIDByUser[userID]; !ok {
		store.CurrentIDByUser[userID] = 0
	}

	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(store.TasksByUser[userID])

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

		store.CurrentIDByUser[userID]++
		t := Task{
			ID:     store.CurrentIDByUser[userID],
			Title:  title,
			Status: "todo",
			Note:   strings.TrimSpace(req.Note),
		}

		store.TasksByUser[userID] = append(store.TasksByUser[userID], t)
		saveStore()
		json.NewEncoder(w).Encode(t)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func taskHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID := getUserID(r)

	idStr := strings.TrimPrefix(r.URL.Path, "/tasks/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", http.StatusBadRequest)
		return
	}

	tasks := store.TasksByUser[userID]
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
			tasks[index].Status = normalizeStatus(*req.Status)
		}

		store.TasksByUser[userID] = tasks
		saveStore()
		json.NewEncoder(w).Encode(tasks[index])

	case "DELETE":
		tasks = append(tasks[:index], tasks[index+1:]...)
		store.TasksByUser[userID] = tasks
		saveStore()
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

