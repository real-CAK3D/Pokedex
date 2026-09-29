// Rear camera + compass for the AR view. The camera stream is shared and
// reference-counted, so the AR scanner and an AR catch can both use it and
// it switches off as soon as nobody needs it.

let stream = null;
let users = 0;

export async function acquireCamera() {
  users++;
  if (!stream) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not supported here');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  }
  return stream;
}

export function releaseCamera() {
  users = Math.max(0, users - 1);
  if (!users && stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

export function videoFor(s) {
  const v = document.createElement('video');
  v.className = 'cam-video';
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.autoplay = true;
  v.srcObject = s;
  v.play().catch(() => {});
  return v;
}

// ---- compass ----
export const compass = { heading: null, live: false };
let listening = false;

function onOrient(e) {
  let hd = null;
  if (typeof e.webkitCompassHeading === 'number') hd = e.webkitCompassHeading;          // iOS
  else if (e.absolute && typeof e.alpha === 'number') hd = (360 - e.alpha) % 360;       // Android
  if (hd == null) return;
  // account for the screen being rotated
  const rot = screen.orientation?.angle || 0;
  compass.heading = (hd + rot + 360) % 360;
  compass.live = true;
}

// Must be called from a tap on iOS (permission prompt).
export async function startCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch { /* denied: we fall back to drag-to-look */ }
  if (listening) return;
  listening = true;
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}
