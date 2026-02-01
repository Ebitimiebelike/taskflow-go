package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Task struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	Status    string    `json:"status"` // todo|progress|done
	Note      string    `json:"note"`
	UpdatedAt int64     `json:"updatedAt"`
	CreatedAt int64     `json:"createdAt"`
}

type Store struct {
	mu       sync.Mutex
	Users    map[string][]Task `json:"users"`
	NextID   map[string]int    `json:"nextId"`
	Modified int64             `json:"modified"`
}

var dataFile = "tasks.json"
var store = Store{
	Users:  map[string][]Task{},
	NextID: map[string]int{},
}

func main() {
	loadStore()

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/tasks", tasksHandler)   // GET, POST
	mux.HandleFunc("/api/tasks/", taskHandler)   // PUT, DELETE

	// Frontend static
	publicDir := "./public"
	fs := http.FileServer(http.Dir(publicDir))
	mux.Handle("/", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server running on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, withCORS(mux)))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If your frontend is hosted separately, you can set a specific origin here instead of "*"
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Id")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func userID(r *http.Request) (string, error) {
	id := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if id == "" {
		return "", errors.New("missing X-User-Id header")
	}
	return id, nil
}

func normalizeStatus(s string) string {
	switch s {
	case "todo", "progress", "done":
		return s
	default:
		return "todo"
	}
}

func tasksHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	uid, err := userID(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		store.mu.Lock()
		tasks := store.Users[uid]
		store.mu.Unlock()
		json.NewEncoder(w).Encode(tasks)

	case "POST":
		var body struct {
			Title string `json:"title"`
			Note  string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Title) == "" {
			http.Error(w, "invalid task data", http.StatusBadRequest)
			return
		}

		now := time.Now().Unix()

		store.mu.Lock()
		store.NextID[uid]++
		id := store.NextID[uid]
		task := Task{
			ID:        id,
			Title:     strings.TrimSpace(body.Title),
			Note:      strings.TrimSpace(body.Note),
			Status:    "todo",
			CreatedAt: now,
			UpdatedAt: now,
		}
		store.Users[uid] = append(store.Users[uid], task)
		store.Modified = now
		store.mu.Unlock()

		saveStore()
		json.NewEncoder(w).Encode(task)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func taskHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	uid, err := userID(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid task id", http.StatusBadRequest)
		return
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	tasks := store.Users[uid]
	idx := -1
	for i := range tasks {
		if tasks[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case "PUT":
		var patch struct {
			Status string `json:"status"`
			Note   string `json:"note"`
			Title  string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}

		if strings.TrimSpace(patch.Title) != "" {
			tasks[idx].Title = strings.TrimSpace(patch.Title)
		}
		if patch.Note != "" || patch.Note == "" {
			// allow clearing note
			tasks[idx].Note = strings.TrimSpace(patch.Note)
		}
		if patch.Status != "" {
			tasks[idx].Status = normalizeStatus(patch.Status)
		}
		tasks[idx].UpdatedAt = time.Now().Unix()
		store.Users[uid] = tasks
		store.Modified = time.Now().Unix()

		saveStore()
		json.NewEncoder(w).Encode(tasks[idx])

	case "DELETE":
		store.Users[uid] = append(tasks[:idx], tasks[idx+1:]...)
		store.Modified = time.Now().Unix()

		saveStore()
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func loadStore() {
	// If file doesn't exist, start fresh
	f, err := os.ReadFile(dataFile)
	if err != nil {
		log.Println("tasks.json not found, starting fresh")
		return
	}

	var s Store
	if err := json.Unmarshal(f, &s); err != nil {
		log.Println("failed to parse tasks.json, starting fresh:", err)
		return
	}

	// Basic sanity
	if s.Users == nil {
		s.Users = map[string][]Task{}
	}
	if s.NextID == nil {
		s.NextID = map[string]int{}
	}

	store.mu.Lock()
	store = s
	store.mu.Unlock()
}

func saveStore() {
	store.mu.Lock()
	defer store.mu.Unlock()

	b, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		log.Println("save error:", err)
		return
	}

	// Ensure dir exists (helps in some environments)
	_ = os.MkdirAll(filepath.Dir(dataFile), 0755)

	if err := os.WriteFile(dataFile, b, 0644); err != nil {
		log.Println("write error:", err)
	}
}
