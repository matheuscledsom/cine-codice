import {
  Award,
  Clapperboard,
  Compass,
  Film,
  Flame,
  ImagePlus,
  Sparkles,
  Star,
  Trash2,
  Tv,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { PROFILE_AVATAR_EMBLEMS } from '../lib/profileMetrics';
import { putRelationalApiCache } from '../services/relationalDb';
import { ImageCropModal } from './ImageCropModal';

export const AVATAR_EMBLEM_COMPONENTS = {
  Film,
  Clapperboard,
  Tv,
  Sparkles,
  Award,
  Compass,
  Flame,
  Star,
};

export function ProfileEditModal({ isOpen, onClose, profile, onSave }) {
  const [draft, setDraft] = useState(profile);
  const [cropSession, setCropSession] = useState(null);
  const coverInputRef = useRef(null);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(profile);
    }
  }, [isOpen, profile]);

  useEffect(() => {
    return () => {
      if (cropSession?.objectUrl) {
        URL.revokeObjectURL(cropSession.objectUrl);
      }
    };
  }, [cropSession]);

  if (!isOpen) return null;

  const { editModal } = domainConfig.ui.profile;

  const startCropFromFile = (file, targetField, aspectMode) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const objectUrl = URL.createObjectURL(file);
      setCropSession({ targetField, aspectMode, objectUrl });
    } catch {
      // Ignora arquivo inválido
    }
  };

  const closeCropSession = () => {
    if (cropSession?.objectUrl) {
      URL.revokeObjectURL(cropSession.objectUrl);
    }
    setCropSession(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    putRelationalApiCache(
      'profile:local_avatar_v120',
      {
        avatarUrl: draft.avatarUrl || '',
        avatarIcon: draft.avatarIcon || 'Film',
        updatedAt: Date.now(),
      },
      { ttlMs: 365 * 24 * 60 * 60 * 1000 }
    ).catch(() => {});
    onSave(draft);
    onClose();
  };

  const SelectedEmblemIcon =
    AVATAR_EMBLEM_COMPONENTS[draft?.avatarIcon] ||
    AVATAR_EMBLEM_COMPONENTS.Film;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-xs"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-x border-t border-line bg-card p-5 pb-8 shadow-2xl no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{editModal.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={domainConfig.ui.detail.closeLabel}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-1 text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Banner / Foto de Capa */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              {editModal.coverLabel}
            </span>
            {draft.coverUrl && (
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, coverUrl: '' }))}
                className="inline-flex items-center gap-1 text-[11px] text-rose-400 hover:underline"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                {editModal.clearImageLabel}
              </button>
            )}
          </div>

          <div className="relative h-24 w-full overflow-hidden rounded-2xl border border-line bg-app">
            {draft.coverUrl ? (
              <img
                src={draft.coverUrl}
                alt="Capa"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-r from-accent/35 via-elevated to-accent/15" />
            )}
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="absolute bottom-2 right-2 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-black/70 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur-xs hover:bg-black"
            >
              <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              {editModal.coverUploadLabel}
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                startCropFromFile(file, 'coverUrl', 'cover');
              }}
              className="hidden"
            />
          </div>

          <input
            type="url"
            value={draft.coverUrl?.startsWith('data:') ? '' : draft.coverUrl || ''}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, coverUrl: e.target.value }))
            }
            placeholder={editModal.coverUrlPlaceholder}
            className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>

        {/* Avatar Customizável: Upload 256x256 px OU 8 Emblemas Cinematográficos Minimalistas */}
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              {editModal.avatarLabel} (Foto 256×256 ou Emblema)
            </span>
            {draft.avatarUrl && (
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, avatarUrl: '' }))}
                className="inline-flex items-center gap-1 text-[11px] text-rose-400 hover:underline"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                {editModal.clearImageLabel}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-accent bg-app text-accent">
              {draft.avatarUrl ? (
                <img
                  src={draft.avatarUrl}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : draft.avatarIcon && AVATAR_EMBLEM_COMPONENTS[draft.avatarIcon] ? (
                <SelectedEmblemIcon className="h-7 w-7 text-accent" strokeWidth={1.5} />
              ) : (
                <SelectedEmblemIcon className="h-7 w-7 text-accent" strokeWidth={1.5} />
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
              >
                <Upload className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                {editModal.avatarUploadLabel}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  startCropFromFile(file, 'avatarUrl', 'avatar');
                }}
                className="hidden"
              />
              <input
                type="url"
                value={draft.avatarUrl?.startsWith('data:') ? '' : draft.avatarUrl || ''}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, avatarUrl: e.target.value }))
                }
                placeholder={editModal.avatarUrlPlaceholder}
                className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Seletor dos 8 Emblemas Cinematográficos Minimalistas */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-medium text-subtle">
              Ou escolha um emblema cinematográfico:
            </span>
            <div className="grid grid-cols-4 gap-2">
              {PROFILE_AVATAR_EMBLEMS.map((emblem) => {
                const IconComp = AVATAR_EMBLEM_COMPONENTS[emblem.id] || Film;
                const active =
                  !draft.avatarUrl && (draft.avatarIcon || 'Film') === emblem.id;
                return (
                  <button
                    key={emblem.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        avatarIcon: emblem.id,
                        avatarUrl: '',
                      }))
                    }
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-[10px] font-medium transition-colors ${
                      active
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-line bg-app text-muted hover:border-accent hover:text-ink'
                    }`}
                  >
                    <IconComp className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="w-full truncate text-center">
                      {emblem.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {editModal.nameLabel}
            </span>
            <input
              type="text"
              value={draft.displayName || ''}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, displayName: e.target.value }))
              }
              className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-muted">
            {editModal.bioLabel}
          </span>
          <textarea
            rows={2}
            value={draft.bio || ''}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, bio: e.target.value }))
            }
            className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </label>

        <button
          type="submit"
          className="mt-5 min-h-[44px] w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          {editModal.saveLabel}
        </button>
      </form>

      <ImageCropModal
        isOpen={Boolean(cropSession)}
        imageSrc={cropSession?.objectUrl || ''}
        aspectMode={cropSession?.aspectMode || 'avatar'}
        onCancel={closeCropSession}
        onConfirm={(croppedDataUrl) => {
          if (cropSession?.targetField) {
            setDraft((prev) => ({
              ...prev,
              [cropSession.targetField]: croppedDataUrl,
            }));
          }
          closeCropSession();
        }}
      />
    </div>
  );
}
