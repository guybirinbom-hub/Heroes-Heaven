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

/**
 * Read an image File and return a data URL whose longest edge is at most `maxDim` px, re-encoded as
 * JPEG (or PNG when the source has transparency) at `quality`. SVG/GIF are passed through unchanged
 * (canvas can't faithfully re-encode them). Returns whichever of the original/re-encoded URL is
 * smaller, so tiny images never grow.
 */
export async function downscaleImage(file: File, maxDim = 384, quality = 0.82): Promise<string> {
  const original = await readFileAsDataURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return original;
  let img: HTMLImageElement;
  try {
    img = await loadImage(original);
  } catch {
    return original; // can't decode — store as-is rather than failing the import
  }
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  return out.length < original.length ? out : original;
}
