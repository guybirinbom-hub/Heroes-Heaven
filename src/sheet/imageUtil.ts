/*
 * Portrait image handling.
 *
 * Portraits (character + companion) are stored as base64 data URLs inside the roster in
 * localStorage, which has a ~5MB quota for the entire app. A single phone photo can be several MB,
 * so importing a couple uncapped images can blow the quota and (previously, silently) lose the whole
 * roster. downscaleImage shrinks the longest edge to `maxDim` and re-encodes — typically cutting a
 * multi-MB photo to a few tens of KB — before anything is persisted.
 */

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
export async function downscaleDataUrl(original: string, maxDim = 384, quality = 0.82): Promise<string> {
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
export async function downscaleImage(file: File, maxDim = 384, quality = 0.82): Promise<string> {
  const original = await readFileAsDataURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return original;
  try {
    return await downscaleDataUrl(original, maxDim, quality);
  } catch {
    return original; // can't decode — store as-is rather than failing the upload
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
