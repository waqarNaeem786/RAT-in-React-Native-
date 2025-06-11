import { request, PERMISSIONS, PermissionStatus } from 'react-native-permissions';

export async function requestPermissions(): Promise<void> {
  try {
    const cameraStatus: PermissionStatus = await request(PERMISSIONS.ANDROID.CAMERA);
    const locationStatus: PermissionStatus = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
    const contactsStatus: PermissionStatus = await request(PERMISSIONS.ANDROID.READ_CONTACTS);

    console.log({
      cameraStatus,
      locationStatus,
      contactsStatus,
    });
  } catch (error) {
    console.warn('Permission request error:', error);
  }
}
