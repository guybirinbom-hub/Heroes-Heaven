/*
 * Portrait image handling.
 *
 * Portraits (character + companion) are stored as base64 data URLs inside the roster in
 * localStorage, which has a ~5MB quota for the entire app. A single phone photo can be several MB,
 * so importing a couple uncapped images can blow the quota and (previously, silently) lose the whole
 * roster. downscaleImage shrinks the longest edge to `maxDim` and re-encodes — typically cutting a
 * multi-MB photo to a few tens of KB — before anything is persisted.
 */
import { isTauri } from '../platform';

/* Two tiers. The COMPRESSED copy is what lives in the character data — it syncs to the cloud and is
 * shown on the web, so it stays small (under the ~5MB browser cap, and light to sync). On the INSTALLED
 * app we ALSO keep a SHARP copy on-device (IndexedDB, never synced — see data/portraitStore.ts) shown
 * in place of the compressed one. So the synced/online portrait is always the compressed tier on every
 * platform; the sharp tier never leaves the device it was uploaded on. */
const COMPRESSED_MAX = 384;
const COMPRESSED_QUALITY = 0.82;
const SHARP_MAX = 768;
const SHARP_QUALITY = 0.9;
/** Default downscale target = the compressed (synced) tier — used by imports and any generic caller. */
const PORTRAIT_MAX_DIM = COMPRESSED_MAX;
const PORTRAIT_QUALITY = COMPRESSED_QUALITY;

export interface PortraitTiers {
  /** Small copy stored in the (synced) character data + shown on the web. */
  compressed: string;
  /** Sharper copy for the installed app's on-device store; absent on the web (or when not worth it). */
  sharp?: string;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read failed')));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/** Mime type of a data URL ("data:image/png;base64,…" → "image/png"). */
function mimeOfDataUrl(url: string): string {
  return /^data:([^;,]+)/.exec(url)?.[1] ?? '';
}

/**
 * Re-encode a data-URL image so its longest edge is at most `maxDim` px, as JPEG (or PNG when the
 * source is PNG, preserving transparency) at `quality`. Returns whichever of the original/re-encoded
 * URL is smaller, so tiny images never grow. Rejects when the image can't be decoded or no canvas
 * is available — callers decide whether to keep or drop the original.
 */
export async function downscaleDataUrl(original: string, maxDim = PORTRAIT_MAX_DIM, quality = PORTRAIT_QUALITY): Promise<string> {
  const img = await loadImage(original);
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL(mimeOfDataUrl(original) === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  return out.length < original.length ? out : original;
}

/**
 * Read an image File and return a data URL whose longest edge is at most `maxDim` px, re-encoded as
 * JPEG (or PNG when the source has transparency) at `quality`. SVG/GIF are passed through unchanged
 * (canvas can't faithfully re-encode them).
 */
export async function downscaleImage(file: File, maxDim = PORTRAIT_MAX_DIM, quality = PORTRAIT_QUALITY): Promise<string> {
  const original = await readFileAsDataURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return original;
  try {
    return await downscaleDataUrl(original, maxDim, quality);
  } catch {
    return original; // can't decode — store as-is rather than failing the upload
  }
}

/**
 * Produce the tiers for an uploaded portrait: always the cloud-safe compressed copy, plus — on the
 * installed app only — a sharper on-device copy. The sharp copy is dropped when it wouldn't actually
 * be larger than the compressed one (tiny source image), so we never store a redundant duplicate.
 */
export async function processPortrait(file: File): Promise<PortraitTiers> {
  const compressed = await downscaleImage(file, COMPRESSED_MAX, COMPRESSED_QUALITY);
  if (!isTauri) return { compressed };
  try {
    const sharp = await downscaleImage(file, SHARP_MAX, SHARP_QUALITY);
    return { compressed, sharp: sharp.length > compressed.length ? sharp : undefined };
  } catch {
    return { compressed };
  }
}

/** Same two tiers from an existing data URL (portrait migration / import rather than a File pick). */
export async function processPortraitDataUrl(url: string): Promise<PortraitTiers> {
  const compressed = await downscaleDataUrl(url, COMPRESSED_MAX, COMPRESSED_QUALITY);
  if (!isTauri) return { compressed };
  try {
    const sharp = await downscaleDataUrl(url, SHARP_MAX, SHARP_QUALITY);
    return { compressed, sharp: sharp.length > compressed.length ? sharp : undefined };
  } catch {
    return { compressed };
  }
}

/** The largest imported portrait we'll keep WITHOUT re-encoding (pass-through formats, or images the
 *  canvas can't decode). Anything bigger that can't be shrunk is dropped instead of stored raw — a
 *  multi-MB data URL is deep-copied into every undo step and can blow the ~5MB localStorage quota
 *  by itself (worst on Android). */
export const MAX_RAW_PORTRAIT_CHARS = 1_000_000;

/**
 * Sanitize a portrait arriving inside an imported character file (WG exports embed the full-resolution
 * base64 image verbatim): downscale embedded data-URL images exactly like an in-app upload. Small
 * SVG/GIF pass through unchanged; an image that can't be re-encoded is kept only while small, else
 * dropped (undefined). Non-data URLs (plain http links) are tiny strings and pass through untouched.
 */
export async function sanitizeImportedPortrait(url: string | undefined): Promise<string | undefined> {
  if (!url || !url.startsWith('data:')) return url || undefined;
  const mime = mimeOfDataUrl(url);
  if ((mime === 'image/svg+xml' || mime === 'image/gif') && url.length <= MAX_RAW_PORTRAIT_CHARS) return url;
  try {
    return await downscaleDataUrl(url);
  } catch {
    return url.length <= MAX_RAW_PORTRAIT_CHARS ? url : undefined;
  }
}
