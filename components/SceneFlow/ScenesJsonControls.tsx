'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';

/**
 * Admin-only JSON I/O controls for a story's scenes.
 *
 * Export: downloads the current scenes as the Anthropic-API-response
 * envelope (so the file looks identical to what generate-scenes would
 * have produced + can be re-imported into any story without re-paying
 * the Sonnet call).
 *
 * Import: paste-area for a JSON envelope (or just a scenes array).
 * On success, replaces all scenes on the story in a single tx.
 */
export function ScenesJsonControls({
  storyId,
  onImported
}: {
  storyId: string;
  onImported?: () => void;
}) {
  const isAdmin = useIsAdmin();
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);

  if (isAdmin !== true) return null;

  function onExport() {
    const url = `/api/admin/sceneflow/stories/${encodeURIComponent(storyId)}/export-scenes`;
    // browser handles content-disposition; just navigate.
    window.open(url, '_blank');
  }

  async function onImport() {
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(importText);
      } catch (e) {
        toast.error('Kein gültiges JSON: ' + (e as Error).message);
        return;
      }
      const res = await fetch(
        `/api/admin/sceneflow/stories/${encodeURIComponent(storyId)}/import-scenes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed)
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error('Import fehlgeschlagen: ' + (body.error ?? `HTTP ${res.status}`));
        return;
      }
      const body = (await res.json()) as {
        scenes: unknown[];
        unknownCharacterNames: string[];
      };
      toast.success(
        `${body.scenes.length} Szene(n) importiert.` +
          (body.unknownCharacterNames.length > 0
            ? ` Unbekannte Charaktere: ${body.unknownCharacterNames.join(', ')}`
            : '')
      );
      setShowImport(false);
      setImportText('');
      onImported?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-[var(--a1)]/30 bg-[var(--a1)]/5 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--a1)]">
          Admin · JSON
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onExport}
          className="text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] rounded px-2 py-1"
          title="Aktuelle Szenen als JSON herunterladen (Sonnet-Envelope-Format)"
        >
          ↓ Export
        </button>
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] rounded px-2 py-1"
          title="Szenen aus JSON laden (überschreibt aktuelle Szenen!)"
        >
          ↑ Import …
        </button>
      </div>
      {showImport && (
        <div className="space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder='JSON einfügen — Anthropic-Envelope, { "scenes": [...] }, oder bare Array. Bestehende Szenen werden ersetzt.'
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-[11px] font-mono"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onImport}
              disabled={busy || importText.trim().length === 0}
              className="text-xs bg-[var(--a1)] text-white rounded px-3 py-1 disabled:opacity-30"
            >
              {busy ? '…' : 'Szenen ersetzen'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowImport(false);
                setImportText('');
              }}
              disabled={busy}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
