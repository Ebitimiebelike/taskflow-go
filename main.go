package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	mux := http.NewServeMux()

	// quick test endpoint (so we know the server is alive)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// API endpoints (you can plug your handlers back in)
	// mux.HandleFunc("/api/tasks", tasksHandler)
	// mux.HandleFunc("/api/tasks/", taskHandler)

	// Frontend (must be ./public/index.html etc)
	fs := http.FileServer(http.Dir("./public"))
	mux.Handle("/", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server running on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
