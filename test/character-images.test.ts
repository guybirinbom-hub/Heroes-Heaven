import { describe, it, expect } from 'vitest';
import {
  addGalleryImage,
  makeProfileImage,
  removeGalleryImage,
  setAvatar,
  setGalleryCaption,
  setPortrait,
} from '../src/rules/play';
import type { PlayState } from '../src/rules/play';

// These actions read and write nothing but `appearance`, so a bare state is the honest fixture —
// building a real one would drag in a character and the whole content database for no added coverage.
const base = (): PlayState => ({ heroPoints: 0, xp: 0 }) as PlayState;

describe('character images', () => {
  it('an untouched character carries no image fields at all', () => {
    expect(base().appearance?.gallery).toBeUndefined();
    expect(base().appearance?.avatar).toBeUndefined();
  });

  it('setPortrait stores the compressed copy and its sharp ref', () => {
    const p = setPortrait(base(), 'data:profile', 'ref-1');
    expect(p.appearance?.portrait).toBe('data:profile');
    expect(p.appearance?.portraitRef).toBe('ref-1');
  });

  it('replacing the picture drops the avatar crop, which framed the OLD one', () => {
    let p = setPortrait(base(), 'data:first', 'ref-1');
    p = setAvatar(p, 'data:crop-of-first');
    expect(p.appearance?.avatar).toBe('data:crop-of-first');
    p = setPortrait(p, 'data:second', 'ref-2');
    expect(p.appearance?.avatar).toBeUndefined();
  });

  it('clearing the picture clears its ref and crop too', () => {
    let p = setAvatar(setPortrait(base(), 'data:a', 'ref-1'), 'data:crop');
    p = setPortrait(p, null);
    expect(p.appearance?.portrait).toBeUndefined();
    expect(p.appearance?.portraitRef).toBeUndefined();
    expect(p.appearance?.avatar).toBeUndefined();
  });

  it('gallery images get unique ids and are removed by id', () => {
    let p = addGalleryImage(base(), 'data:one', 'ref-1');
    p = addGalleryImage(p, 'data:two');
    const ids = p.appearance!.gallery!.map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    p = removeGalleryImage(p, ids[0]);
    expect(p.appearance!.gallery!.map((g) => g.img)).toEqual(['data:two']);
  });

  it('emptying the gallery removes the field rather than leaving []', () => {
    let p = addGalleryImage(base(), 'data:one');
    p = removeGalleryImage(p, p.appearance!.gallery![0].id);
    expect(p.appearance?.gallery).toBeUndefined();
  });

  it('a gallery image keys its sharp copy under `portraitRef`, which is what the GC walks for', () => {
    // data/portraitStore's collectPortraitRefs looks for that exact key anywhere in the character; a
    // differently-named field would leave every gallery image's sharp copy eligible for deletion.
    const p = addGalleryImage(base(), 'data:one', 'ref-9');
    expect(p.appearance!.gallery![0].portraitRef).toBe('ref-9');
  });

  it('makeProfileImage SWAPS: the old profile takes the promoted image’s place', () => {
    let p = setPortrait(base(), 'data:old-profile', 'ref-old');
    p = addGalleryImage(p, 'data:promote-me', 'ref-new');
    const id = p.appearance!.gallery![0].id;
    p = makeProfileImage(p, id);
    expect(p.appearance?.portrait).toBe('data:promote-me');
    expect(p.appearance?.portraitRef).toBe('ref-new');
    // Nothing is lost and the count is unchanged — the old profile is now the gallery entry.
    expect(p.appearance!.gallery!.map((g) => g.img)).toEqual(['data:old-profile']);
    expect(p.appearance!.gallery![0].portraitRef).toBe('ref-old');
  });

  it('makeProfileImage drops the avatar crop — it framed a region of a different picture', () => {
    let p = setAvatar(setPortrait(base(), 'data:old', 'ref-old'), 'data:crop');
    p = addGalleryImage(p, 'data:new');
    p = makeProfileImage(p, p.appearance!.gallery![0].id);
    expect(p.appearance?.avatar).toBeUndefined();
  });

  it('promoting into an EMPTY profile slot just moves the image out of the gallery', () => {
    let p = addGalleryImage(base(), 'data:only');
    p = makeProfileImage(p, p.appearance!.gallery![0].id);
    expect(p.appearance?.portrait).toBe('data:only');
    expect(p.appearance?.gallery).toBeUndefined();
  });

  it('makeProfileImage on an unknown id changes nothing', () => {
    const p = addGalleryImage(setPortrait(base(), 'data:a'), 'data:b');
    expect(makeProfileImage(p, 'img-nope')).toBe(p);
  });

  it('captions are set and cleared', () => {
    let p = addGalleryImage(base(), 'data:one');
    const id = p.appearance!.gallery![0].id;
    p = setGalleryCaption(p, id, 'In the tavern');
    expect(p.appearance!.gallery![0].caption).toBe('In the tavern');
    p = setGalleryCaption(p, id, '   ');
    expect(p.appearance!.gallery![0].caption).toBeUndefined();
  });

  it('never mutates the state it was handed', () => {
    const p0 = setPortrait(base(), 'data:a', 'ref-a');
    const snapshot = JSON.stringify(p0);
    addGalleryImage(p0, 'data:b');
    setAvatar(p0, 'data:crop');
    setPortrait(p0, null);
    expect(JSON.stringify(p0)).toBe(snapshot);
  });
});
