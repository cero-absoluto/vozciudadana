// Snapshot only existing evidence; this never requests browser geolocation.
export function participationGpsSnapshot(ui, device, storage) {
  const cached = key => {
    const value = storage.getItem(key);
    return typeof value === 'string' && value.trim() ? Number(value) : null;
  };
  const lat = ui.gpsLat ?? cached('vc_gps_lat') ?? (device.gpsReady ? device.gpsLat : null);
  const lng = ui.gpsLng ?? cached('vc_gps_lng') ?? (device.gpsReady ? device.gpsLng : null);
  const accuracy = ui.gpsAccuracy ?? cached('vc_gps_accuracy') ?? (device.gpsReady ? device.gpsAccuracy : null);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return {lat:null,lng:null,accuracy:null};
  return {lat,lng,accuracy:Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null};
}
