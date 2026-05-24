'use client';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function CharacterCard({
  character,
  onEdit,
  onDelete
}: {
  character: CharacterRecord;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <div className="flex items-center gap-3 bg-[var(--surface-2)] rounded-lg p-2">
      {character.reference_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.reference_image_url}
          alt={character.name}
          className="w-12 h-12 object-cover rounded-full bg-[var(--surface-3)]"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-xl text-[var(--text-muted)]">
          {character.type === 'group' ? '👥' : '👤'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text)] truncate">{character.name}</span>
          <span className="text-[10px] uppercase text-[var(--text-muted)]">
            {character.type}
          </span>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {character.voice_provider
            ? `${character.voice_provider} · ${character.voice_id ?? ''}`
            : 'Keine Stimme'}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs text-[var(--a2)] hover:text-[var(--a1)] px-2"
      >
        Bearbeiten
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Löschen"
        className="text-xs text-[var(--text-muted)] hover:text-red-400 px-2"
      >
        ✕
      </button>
    </div>
  );
}
