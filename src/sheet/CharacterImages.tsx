import { useRef, useState } from 'react';
import type { Character } from '../rules/types';
import {
  addGalleryImage,
  makeProfileImage,
  removeGalleryImage,
  setAvatar,
  setGalleryCaption,
  setPortrait,
  type PlayUpdater,
} from '../rules/play';
import { getSharpPortrait } from '../data/portraitStore';
import { uploadImage } from './portraitUpload';
import { usePortrait } from './usePortrait';
import { AvatarCropModal } from './AvatarCropModal';
import { confirmDialog } from './confirm';

/**
 * The character's pictures, on the Details page.
 *
 * Deliberately small when there is nothing to manage: one picture and this is just that picture plus a
 * two-button row. The thumbnail strip, the "Make profile" action and the captions only appear once a
 * second image exists, so the common case — everybody's single portrait — costs a card and no chrome.
 *
 * The profile image is shown WHOLE here (letterboxed, never cropped). That's the half of the problem
 * this solves: the small avatar everywhere else is a square the player framed on the face, and this is
 * where the full picture they uploaded still lives.
 */
export function CharacterImages({ character, onPlay }: { character: Character; onPlay?: PlayUpdater }) {
  const app = character.appearance;
  const gallery = app?.gallery ?? [];
  const profile = usePortrait(app?.portraitRef, app?.portrait);
  const editable = !!onPlay;

  // Where a picked file goes: the profile slot, or the end of the gallery.
  const [target, setTarget] = useState<'profile' | 'gallery'>('profile');
  const fileRef = useRef<HTMLInputElement>(null);
  // The picture being framed for the avatar, plus what to do with it once framed.
  const [cropping, setCropping] = useState<{ src: string; compressed: string; ref?: string } | null>(null);
  // Full-size viewer for a gallery picture.
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (to: 'profile' | 'gallery') => {
    setTarget(to);
    fileRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // let the same file be picked again later
    if (!file || !onPlay) return;
    setBusy(true);
    uploadImage(file)
      .then(({ compressed, ref }) => {
        if (target === 'gallery') {
          onPlay((p) => addGalleryImage(p, compressed, ref));
          return;
        }
        // A new profile picture goes straight into the frame-the-avatar step. Store it first so the
        // upload isn't lost if the dialog is cancelled — cancelling then just leaves the centre crop.
        onPlay((p) => setPortrait(p, compressed, ref));
        setCropping({ src: (ref && getSharpPortrait(ref)) || compressed, compressed, ref });
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const reframe = () => {
    if (!app?.portrait) return;
    setCropping({ src: profile ?? app.portrait, compressed: app.portrait, ref: app.portraitRef });
  };

  const clearProfile = async () => {
    if (!onPlay) return;
    const ok = await confirmDialog({
      title: 'Remove the profile picture?',
      message: 'The other pictures in the gallery are kept. You can undo with Ctrl+Z.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) onPlay((p) => setPortrait(p, null));
  };

  const removeFromGallery = async (id: string) => {
    if (!onPlay) return;
    const ok = await confirmDialog({
      title: 'Remove this picture?',
      message: 'It is removed from this character. You can undo with Ctrl+Z.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) onPlay((p) => removeGalleryImage(p, id));
  };

  const empty = !app?.portrait && gallery.length === 0;
  if (empty && !editable) return null;

  return (
    <section className="card">
      <div className="ct">
        <i className="ti ti-photo" aria-hidden="true" />
        Images
        {gallery.length > 0 && <span className="ol-count"> {gallery.length + (app?.portrait ? 1 : 0)}</span>}
      </div>

      {app?.portrait ? (
        <>
          <button
            type="button"
            className="cimg-main"
            title="View full size"
            onClick={() => setViewing(profile ?? app.portrait ?? null)}
          >
            <img src={profile} alt={`${character.name} — profile picture`} />
          </button>
          {editable && (
            <div className="cimg-actions">
              <button className="btn" onClick={reframe}>
                <i className="ti ti-crop" aria-hidden="true" /> Reframe avatar
              </button>
              <button className="btn" disabled={busy} onClick={() => pick('profile')}>
                <i className="ti ti-repeat" aria-hidden="true" /> Replace
              </button>
              <button className="btn" disabled={busy} onClick={() => pick('gallery')}>
                <i className="ti ti-plus" aria-hidden="true" /> Add image
              </button>
              <button className="btn cimg-remove" onClick={() => void clearProfile()}>
                <i className="ti ti-trash" aria-hidden="true" /> Remove
              </button>
            </div>
          )}
          <p className="cimg-note">
            The small portrait beside your character&apos;s name is the square you framed.{' '}
            {app.avatar ? 'Reframe it any time.' : 'Reframe it to pick which part shows.'}
          </p>
        </>
      ) : (
        editable && (
          <div className="cimg-empty">
            <button className="btn" disabled={busy} onClick={() => pick('profile')}>
              <i className="ti ti-photo-plus" aria-hidden="true" /> Add a picture
            </button>
          </div>
        )
      )}

      {/* Only once there IS more than one picture — a single-portrait character never sees a strip. */}
      {gallery.length > 0 && (
        <div className="cimg-strip">
          {gallery.map((g) => (
            <GalleryThumb
              key={g.id}
              img={g.img}
              imgRef={g.portraitRef}
              caption={g.caption}
              editable={editable}
              onView={(src) => setViewing(src)}
              onMakeProfile={() => onPlay?.((p) => makeProfileImage(p, g.id))}
              onRemove={() => void removeFromGallery(g.id)}
              onCaption={(text) => onPlay?.((p) => setGalleryCaption(p, g.id, text), `img-caption:${g.id}`)}
            />
          ))}
          {editable && (
            <button className="cimg-add" disabled={busy} title="Add another picture" onClick={() => pick('gallery')}>
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {editable && <input ref={fileRef} type="file" accept="image/*" className="portrait-file" onChange={onFile} />}

      {cropping && (
        <AvatarCropModal
          src={cropping.src}
          onCancel={() => setCropping(null)}
          onDone={(avatar) => {
            onPlay?.((p) => setAvatar(p, avatar));
            setCropping(null);
          }}
        />
      )}
      {viewing && (
        <div className="portrait-lightbox" onClick={() => setViewing(null)} role="dialog" aria-label="Picture">
          <img src={viewing} alt="" className="portrait-lightbox-img" />
          <button className="portrait-lightbox-close" onClick={() => setViewing(null)} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

/** One gallery picture: the thumbnail, its caption, and (when editable) its two actions. */
function GalleryThumb({
  img,
  imgRef,
  caption,
  editable,
  onView,
  onMakeProfile,
  onRemove,
  onCaption,
}: {
  img: string;
  imgRef?: string;
  caption?: string;
  editable: boolean;
  onView: (src: string) => void;
  onMakeProfile: () => void;
  onRemove: () => void;
  onCaption: (text: string) => void;
}) {
  const shown = usePortrait(imgRef, img);
  return (
    <div className="cimg-thumb">
      <button type="button" className="cimg-thumb-btn" title="View full size" onClick={() => onView(shown ?? img)}>
        <img src={shown} alt={caption || 'Character picture'} />
      </button>
      {editable ? (
        <>
          <div className="cimg-thumb-acts">
            <button title="Make this the profile picture" aria-label="Make this the profile picture" onClick={onMakeProfile}>
              <i className="ti ti-user-star" aria-hidden="true" />
            </button>
            <button title="Remove this picture" aria-label="Remove this picture" onClick={onRemove}>
              <i className="ti ti-trash" aria-hidden="true" />
            </button>
          </div>
          <input
            className="cimg-caption"
            value={caption ?? ''}
            placeholder="Label…"
            dir="auto"
            aria-label="Picture label"
            onChange={(e) => onCaption(e.target.value)}
          />
        </>
      ) : (
        caption && (
          <div className="cimg-caption-read" dir="auto">
            {caption}
          </div>
        )
      )}
    </div>
  );
}
