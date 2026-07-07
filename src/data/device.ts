// Per-device identity + the installed-app "use offline" choice.
//
// Cloud sync names which machine last wrote the cloud ("Last synced from ⟨label⟩"), so each device
// gets a stable id + a friendly, human-readable label (derived from the platform/browser). The label
// is refreshed on read in case the browser changed; the id stays put so the same device is always
// recognizable across sessions.
//
// The installed desktop/Android app offers an optional login: a user can skip it and stay purely
// local. That choice is persisted here so the app doesn't nag on every launch.
import { isTauri } from '../platform';

const DEVICE_KEY = 'pf2e-codex.device';
const SKIP_KEY = 'pf2e-codex.skipLogin';

export interface DeviceInfo {
  id: string;
  label: string;
}

function ua(): string {
  return (typeof navigator !== 'undefined' && navigator.userAgent) || '';
}

function osName(): string {
  const s = ua();
  if (/Android/i.test(s)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS';
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Linux/i.test(s)) return 'Linux';
  return '';
}

/** A short, friendly name for this device — e.g. "Windows app", "Mac · Safari", "Android · Chrome". */
function deriveLabel(): string {
  const os = osName();
  if (isTauri) return os ? `${os} app` : 'Installed app';
  const s = ua();
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'browser';
  return os ? `${os} · ${browser}` : browser;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** This device's stable id + current friendly label. Created and cached on first call; the label is
 *  kept fresh (the id is never regenerated once assigned). */
export function getDeviceInfo(): DeviceInfo {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<DeviceInfo>;
      if (d && typeof d.id === 'string') {
        const label = deriveLabel();
        if (d.label !== label) {
          d.label = label;
          try {
            localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
          } catch {
            /* non-fatal */
          }
        }
        return d as DeviceInfo;
      }
    }
  } catch {
    /* fall through to create */
  }
  const info: DeviceInfo = { id: newId(), label: deriveLabel() };
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(info));
  } catch {
    /* non-fatal */
  }
  return info;
}

/** Installed app only: did the user choose "continue without an account" (stay offline)? */
export function getLoginSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLoginSkipped(v: boolean): void {
  try {
    if (v) localStorage.setItem(SKIP_KEY, '1');
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    /* non-fatal */
  }
}
