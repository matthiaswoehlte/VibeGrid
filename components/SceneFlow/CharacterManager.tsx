'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import { apiDeleteCharacter } from '@/lib/sceneflow/api-client';
import { CharacterCard } from './CharacterCard';
import { CharacterForm } from './CharacterForm';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function CharacterManager({
  onClose
}: {
  onClose(): void;
}) {
  // The parent (SceneFlowShell) conditionally mounts this component so
  // that closing the modal fully unmounts it. Local state (editing,
  // creating) therefore resets every time the user reopens — without
  // this, an interrupted edit would leave the form pre-selected on the
  // next open instead of showing the list.
  const { characters, loading, refresh } = useSceneFlowCharacters();
  const [editing, setEditing] = useState<CharacterRecord | null>(null);
  const [creating, setCreating] = useState(false);

  async function del(c: CharacterRecord) {
    if (!confirm(`Charakter "${c.name}" wirklich löschen?`)) return;
    try {
      await apiDeleteCharacter(c.id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      return;
    }
    refresh().catch(() => {});
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50" onPointerDown={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-96 bg-[var(--surface-1)] border-l border-[var(--border)] p-4 overflow-y-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text)]">Charaktere</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        {creating || editing ? (
          <CharacterForm
            existing={editing}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
              refresh().catch(() => {});
            }}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded mb-3"
            >
              + Neuer Charakter
            </button>
            {loading && (
              <div className="text-xs text-[var(--text-dim)]">Lädt...</div>
            )}
            {!loading && characters.length === 0 && (
              <div className="text-xs text-[var(--text-dim)]">
                Noch keine Charaktere.
              </div>
            )}
            <ul className="space-y-2">
              {characters.map((c) => (
                <li key={c.id}>
                  <CharacterCard
                    character={c}
                    onEdit={() => setEditing(c)}
                    onDelete={() => del(c)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
