import { newPortraitRef, setSharpPortrait } from '../data/portraitStore';
import { processPortrait } from './imageUtil';

/** A picked image, already split into the two tiers the app stores: the compressed copy that lives in
 *  the (synced) character data, and — on the installed app — a ref keying a sharper on-device copy. */
export interface UploadedImage {
  compressed: string;
  ref?: string;
}

/**
 * Read a picked file into the app's two portrait tiers, writing the sharp copy to the on-device store.
 *
 * Shared by every image entry point (the Details page's profile slot and its gallery) so they all
 * compress, tier and store identically — the storage budget here is the whole app's ~5MB localStorage,
 * and one path that forgot to downscale would be enough to blow it.
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const { compressed, sharp } = await processPortrait(file);
  if (!sharp) return { compressed };
  const ref = newPortraitRef();
  await setSharpPortrait(ref, sharp);
  return { compressed, ref };
}
