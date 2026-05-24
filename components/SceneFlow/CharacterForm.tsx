'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import {
  apiCreateCharacter,
  apiPatchCharacter
} from '@/lib/sceneflow/api-client';
import type {
  CharacterRecord,
  CharacterType,
  VoiceProvider
} from '@/lib/sceneflow/types';

export function CharacterForm({
  existing,
  onSaved,
  onCancel
}: {
  existing: CharacterRecord | null;
  onSaved(): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CharacterType>(existing?.type ?? 'person');
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(
    existing?.reference_image_url ?? null
  );
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider | null>(
    existing?.voice_provider ?? null
  );
  const [voiceId, setVoiceId] = useState(existing?.voice_id ?? '');
  const [imagePrompt, setImagePrompt] = useState(existing?.image_prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const adapter = createR2StorageAdapter();
      const ref = await adapter.uploadImage(file);
      setReferenceImageUrl(ref.url);
      toast.success('Bild hochgeladen');
    } catch (e) {
      toast.error('Upload fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name fehlt');
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        await apiPatchCharacter(existing.id, {
          name,
          type,
          referenceImageUrl,
          voiceProvider,
          voiceId: voiceId.trim() || null,
          imagePrompt: imagePrompt.trim() || null
        });
        toast.success('Charakter aktualisiert');
      } else {
        await apiCreateCharacter({
          name,
          type,
          referenceImageUrl,
          voiceProvider,
          voiceId: voiceId.trim() || null,
          voiceTestText: null,
          imagePrompt: imagePrompt.trim() || null
        });
        toast.success('Charakter angelegt');
      }
      onSaved();
    } catch (e) {
      toast.error('Speichern fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>

      <div className="flex gap-3">
        <label className="text-xs text-[var(--text)]">
          <input
            type="radio"
            name="type"
            value="person"
            checked={type === 'person'}
            onChange={() => setType('person')}
          />{' '}
          Person
        </label>
        <label className="text-xs text-[var(--text)]">
          <input
            type="radio"
            name="type"
            value="group"
            checked={type === 'group'}
            onChange={() => setType('group')}
          />{' '}
          Gruppe
        </label>
      </div>

      <div>
        <span className="text-xs text-[var(--text-dim)]">Referenzbild</span>
        <div className="mt-1 flex items-center gap-2">
          {referenceImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={referenceImageUrl}
              alt="Referenz"
              className="w-12 h-12 object-cover rounded bg-[var(--surface-3)]"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
            disabled={uploading}
            className="text-xs text-[var(--text-dim)]"
          />
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">
          Bild-Prompt (für künftige KI-Generierung)
        </span>
        <textarea
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          rows={2}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
        />
        <button
          type="button"
          disabled
          title="Aktiv ab Plan 8c"
          className="mt-1 text-xs text-[var(--text-muted)] opacity-50 cursor-not-allowed"
        >
          ✨ Generieren (kommt in Plan 8c)
        </button>
      </label>

      <div className="flex gap-3 items-end">
        <label className="flex-1">
          <span className="text-xs text-[var(--text-dim)]">Stimme</span>
          <select
            value={voiceProvider ?? ''}
            onChange={(e) =>
              setVoiceProvider((e.target.value as VoiceProvider) || null)
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          >
            <option value="">—</option>
            <option value="azure">Azure Neural</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>
        </label>
        {voiceProvider && (
          <label className="flex-1">
            <span className="text-xs text-[var(--text-dim)]">
              {voiceProvider === 'azure' ? 'Azure Voice Name' : 'ElevenLabs Voice ID'}
            </span>
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder={
                voiceProvider === 'azure' ? 'de-DE-KillianNeural' : 'voice_id_xyz'
              }
              className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={busy || uploading}
          className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {busy ? '...' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
