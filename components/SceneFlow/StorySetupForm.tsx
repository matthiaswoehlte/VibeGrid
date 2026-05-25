'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import type { StoryRecord, StoryFormat } from '@/lib/sceneflow/types';
import { ModelSelector } from './ModelSelector';

const DEBOUNCE_MS = 500;

export function StorySetupForm({
  story,
  onPatched
}: {
  story: StoryRecord;
  onPatched(patch: Partial<StoryRecord>): void;
}) {
  const { characters: allChars } = useSceneFlowCharacters();
  const [title, setTitle] = useState(story.title);
  const [format, setFormat] = useState<StoryFormat>(story.format);
  const [visualStyle, setVisualStyle] = useState(story.visual_style ?? '');
  const [selected, setSelected] = useState<string[]>(story.characters);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>(
    story.credit_budget !== null ? String(story.credit_budget) : ''
  );
  const titleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const styleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const budgetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-seed local state only on story switch — not on every parent prop
  // update. Including the value in the deps lets server PATCH responses
  // overwrite in-flight keystrokes (same race that ate user text in
  // StoryTextInput). One effect per story.id, batched.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTitle(story.title);
    setFormat(story.format);
    setVisualStyle(story.visual_style ?? '');
    setSelected(story.characters);
    setBudgetInput(
      story.credit_budget !== null ? String(story.credit_budget) : ''
    );
  }, [story.id]);

  function patchTitle(v: string) {
    setTitle(v);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      const next = v.trim() || 'Untitled Story';
      apiPatchStory(story.id, { title: next })
        .then(() => onPatched({ title: next }))
        .catch(() => toast.error('Titel-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }
  function patchFormat(v: StoryFormat) {
    setFormat(v);
    apiPatchStory(story.id, { format: v })
      .then(() => onPatched({ format: v }))
      .catch(() => toast.error('Format-Speichern fehlgeschlagen'));
  }
  function patchVisualStyle(v: string) {
    setVisualStyle(v);
    if (styleTimer.current) clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(() => {
      const val = v.trim() || null;
      apiPatchStory(story.id, { visualStyle: val })
        .then(() => onPatched({ visual_style: val }))
        .catch(() => toast.error('Stil-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }
  function patchBudget(raw: string) {
    setBudgetInput(raw);
    if (budgetTimer.current) clearTimeout(budgetTimer.current);
    budgetTimer.current = setTimeout(() => {
      const trimmed = raw.trim();
      const next = trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)));
      if (next !== null && !Number.isFinite(next)) {
        toast.error('Budget ungültig');
        return;
      }
      apiPatchStory(story.id, { creditBudget: next })
        .then(() => onPatched({ credit_budget: next }))
        .catch(() => toast.error('Budget-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }
  function toggleChar(charId: string) {
    const next = selected.includes(charId)
      ? selected.filter((id) => id !== charId)
      : [...selected, charId];
    setSelected(next);
    apiPatchStory(story.id, { characters: next })
      .then(() => onPatched({ characters: next }))
      .catch(() => toast.error('Charaktere-Speichern fehlgeschlagen'));
  }

  const selectedChars = allChars.filter((c) => selected.includes(c.id));
  const unselectedChars = allChars.filter((c) => !selected.includes(c.id));

  return (
    <section className="space-y-3 bg-[var(--surface-1)] rounded-lg p-4 border border-[var(--border)]">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-[var(--text-dim)]">Titel</span>
          <input
            value={title}
            onChange={(e) => patchTitle(e.target.value)}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--text-dim)]">Format</span>
          <select
            value={format}
            onChange={(e) => patchFormat(e.target.value as StoryFormat)}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          >
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="4:3">4:3</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Visueller Stil</span>
        <input
          value={visualStyle}
          onChange={(e) => patchVisualStyle(e.target.value)}
          placeholder="cinematisch, warmes Licht ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <div>
        <span className="text-xs text-[var(--text-dim)]">Charaktere</span>
        <div className="mt-1 flex flex-wrap gap-1 items-center">
          {selectedChars.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleChar(c.id)}
              className="text-xs bg-[var(--surface-3)] text-[var(--text)] px-2 py-0.5 rounded-full"
              title="Entfernen"
            >
              @{c.name} ×
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCharPicker((v) => !v)}
            className="text-xs text-[var(--a2)] hover:text-[var(--a1)] px-2 py-0.5"
          >
            + Charakter wählen
          </button>
        </div>
        {showCharPicker && (
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto bg-[var(--surface-2)] border border-[var(--border)] rounded p-2">
            {unselectedChars.length === 0 && (
              <li className="text-xs text-[var(--text-dim)]">
                Keine weiteren Charaktere — neue über Charaktere-Drawer anlegen.
              </li>
            )}
            {unselectedChars.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    toggleChar(c.id);
                    setShowCharPicker(false);
                  }}
                  className="w-full text-left text-xs text-[var(--text)] hover:bg-[var(--surface-3)] rounded px-2 py-1"
                >
                  @{c.name}{' '}
                  <span className="text-[var(--text-muted)]">[{c.type}]</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">
          Credit-Budget für diese Story{' '}
          <span className="text-[var(--text-muted)]">(leer = kein Limit)</span>
        </span>
        <input
          type="number"
          min={0}
          step={50}
          value={budgetInput}
          onChange={(e) => patchBudget(e.target.value)}
          placeholder="z.B. 1000"
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <ModelSelector story={story} onPatched={onPatched} />
      <p className="text-[10px] text-[var(--text-muted)]">
        Änderungen wirken sich erst beim nächsten „Mit KI aufteilen” auf
        bestehende Szenen aus.
      </p>
    </section>
  );
}
