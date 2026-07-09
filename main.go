package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Task struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"` // todo | progress | done
	Note      string `json:"note"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Only data is saved (no mutex inside)
type StoreData struct {
	Users  map[string][]Task `json:"users"`
	NextID map[string]int    `json:"nextId"`
}

// Store wraps data with a mutex (mutex is NOT marshaled)
type Store struct {
	mu   sync.Mutex
	data StoreData
}

var dataFile = "tasks.json"

var store = Store{
	data: StoreData{
		Users:  map[string][]Task{},
		NextID: map[string]int{},
	},
}

func main() {
	loadStore()

	// ✅ Serve static files from public directory
	// Get working directory for Railway compatibility
	publicDir := "./public"
	if _, err := os.Stat(publicDir); os.IsNotExist(err) {
		publicDir = "Public" // Railway has capital P
	}
	if _, err := os.Stat(publicDir); os.IsNotExist(err) {
		log.Printf("WARNING: Public directory not found at %s", publicDir)
	}
	fileServer := http.FileServer(http.Dir(publicDir))
	
	// Create a new ServeMux
	mux := http.NewServeMux()
	
	// ✅ Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	
	// ✅ Debug endpoint to check files
	mux.HandleFunc("/debug/files", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		wd, _ := os.Getwd()
		w.Write([]byte("Working directory: " + wd + "\n\n"))
		
		// List files in current directory
		entries, _ := os.ReadDir(".")
		w.Write([]byte("Files in current directory:\n"))
		for _, e := range entries {
			w.Write([]byte("  " + e.Name() + "\n"))
		}
		
		// Check if public exists
		w.Write([]byte("\nChecking for public directories:\n"))
		if _, err := os.Stat("public"); err == nil {
			w.Write([]byte("  ./public exists\n"))
			files, _ := os.ReadDir("public")
			for _, f := range files {
				w.Write([]byte("    - " + f.Name() + "\n"))
			}
		} else {
			w.Write([]byte("  ./public NOT FOUND\n"))
		}
		
		if _, err := os.Stat("Public"); err == nil {
			w.Write([]byte("  ./Public exists\n"))
			files, _ := os.ReadDir("Public")
			for _, f := range files {
				w.Write([]byte("    - " + f.Name() + "\n"))
			}
		} else {
			w.Write([]byte("  ./Public NOT FOUND\n"))
		}
	})
	
	// ✅ API routes (more specific routes first)
	mux.HandleFunc("/api/tasks", tasksHandler)     // Exact match for GET and POST
	mux.HandleFunc("/api/tasks/", taskHandler)   // GET, POST
	
	// ✅ Static files (catch-all, must be last)
	mux.Handle("/", fileServer)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	addr := "0.0.0.0:" + port
	log.Printf("Server starting on %s", addr)
	log.Printf("Public directory: %s", publicDir)
	
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal("Server error:", err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

// -------- helpers --------

func getUserID(r *http.Request) (string, error) {
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

// -------- handlers --------

// /api/tasks  (GET, POST)
func tasksHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    uid, err := getUserID(r)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }

    switch r.Method {
    case "GET":
        store.mu.Lock()
        tasks := store.data.Users[uid]
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
        store.data.NextID[uid]++
        id := store.data.NextID[uid]

        task := Task{
            ID:        id,
            Title:     strings.TrimSpace(body.Title),
            Note:      strings.TrimSpace(body.Note),
            Status:    "todo",
            CreatedAt: now,
            UpdatedAt: now,
        }

        store.data.Users[uid] = append(store.data.Users[uid], task)
        store.mu.Unlock()

        saveStore()

        json.NewEncoder(w).Encode(task)

    default:
        // Combined the two into a single, clean default handler
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    }
}

// /api/tasks/{id}  (PUT, DELETE)
func taskHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	uid, err := getUserID(r)
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
	tasks := store.data.Users[uid]

	idx := -1
	for i := range tasks {
		if tasks[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		store.mu.Unlock()
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case "PUT":
		var patch struct {
			Status string `json:"status"`
			Title  string `json:"title"`
			Note   string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			store.mu.Unlock()
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}

		// Optional edits
		if strings.TrimSpace(patch.Title) != "" {
			tasks[idx].Title = strings.TrimSpace(patch.Title)
		}

		// allow empty note to clear
		tasks[idx].Note = strings.TrimSpace(patch.Note)

		if patch.Status != "" {
			tasks[idx].Status = normalizeStatus(patch.Status)
		}

		tasks[idx].UpdatedAt = time.Now().Unix()
		store.data.Users[uid] = tasks
		store.mu.Unlock()

		saveStore()

		json.NewEncoder(w).Encode(tasks[idx])

	case "DELETE":
		// remove
		store.data.Users[uid] = append(tasks[:idx], tasks[idx+1:]...)
		store.mu.Unlock()

		saveStore()
		w.WriteHeader(http.StatusNoContent)

	default:
		store.mu.Unlock()
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// -------- persistence --------

func loadStore() {
	b, err := os.ReadFile(dataFile)
	if err != nil {
		log.Println("tasks.json not found, starting fresh")
		return
	}

	var d StoreData
	if err := json.Unmarshal(b, &d); err != nil {
		log.Println("failed to parse tasks.json:", err)
		return
	}

	if d.Users == nil {
		d.Users = map[string][]Task{}
	}
	if d.NextID == nil {
		d.NextID = map[string]int{}
	}

	store.mu.Lock()
	store.data = d
	store.mu.Unlock()
}

func saveStore() {
	store.mu.Lock()
	defer store.mu.Unlock()

	b, err := json.MarshalIndent(store.data, "", "  ")
	if err != nil {
		log.Println("save error:", err)
		return
	}

	if err := os.WriteFile(dataFile, b, 0644); err != nil {
		log.Println("write error:", err)
	}
}