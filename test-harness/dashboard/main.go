package main

import (
	"embed"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

//go:embed static/*
var static embed.FS

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

type Hub struct {
	clients map[*websocket.Conn]bool
	mu      sync.RWMutex
}

func (h *Hub) broadcast(msg any) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	data, _ := json.Marshal(msg)
	for c := range h.clients {
		c.WriteMessage(websocket.TextMessage, data)
	}
}

func (h *Hub) broadcastRaw(sender *websocket.Conn, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c != sender {
			c.WriteMessage(websocket.TextMessage, data)
		}
	}
}

func (h *Hub) add(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
}

func (h *Hub) remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

var hub = &Hub{clients: make(map[*websocket.Conn]bool)}

func main() {
	http.Handle("/", http.FileServer(http.FS(static)))
	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/api/event", eventHandler)

	log.Println("Dashboard: http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	hub.add(c)
	defer hub.remove(c)
	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			break
		}
		// Broadcast received messages to all other clients (runner → dashboard UI)
		hub.broadcastRaw(c, msg)
	}
}

func eventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	var event map[string]any
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	hub.broadcast(event)
	w.WriteHeader(204)
}
