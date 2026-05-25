'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import type { StoryRecord, CharacterRecord } from '@/lib/sceneflow/types';

const DEBOUNCE_MS = 500;
const RE_REF = /@(\w+)/g;

export function StoryTextInput({
  story,
  characters,
  allCharacters,
  scenesExist,
  generating,
  onGenerate,
  onStoryTextPatched,
  onCharactersPatched
}: {
  story: StoryRecord;
  /** Characters already attached to this story — used for the
   *  "is the @-ref valid for this story?" check. */
  characters: CharacterRecord[];
  /** All of the user's global characters — used to detect when an
   *  @-ref points to a character that exists but isn't on this story
   *  yet, so we can offer a one-click "Add to story". */
  allCharacters: CharacterRecord[];
  scenesExist: boolean;
  generating: boolean;
  onGenerate(text: string): void | Promise<void>;
  onStoryTextPatched(text: string | null): void;
  onCharactersPatched?(charIds: string[]): void;
}) {
  const [text, setText] = useState(story.story_text ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-seed only when the user switches to a different story. Including
  // `story.story_text` in the deps would let server PATCH responses (which
  // bubble up as new prop values) overwrite in-flight keystrokes — the
  // controlled-input + autosave race that ate user text mid-typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setText(story.story_text ?? '');
  }, [story.id]);

  const { unknownRefs, fixableRefs } = useMemo(() => {
    const inStory = new Set(characters.map((c) => c.name.toLowerCase()));
    const globalByLower = new Map(
      allCharacters.map((c) => [c.name.toLowerCase(), c])
    );
    const refs = Array.from(text.matchAll(RE_REF)).map((m) => m[1]!);
    const unique = Array.from(new Set(refs));
    const unknown: string[] = [];
    const fixable: CharacterRecord[] = [];
    for (const ref of unique) {
      const lower = ref.toLowerCase();
      if (inStory.has(lower)) continue;
      const globalMatch = globalByLower.get(lower);
      if (globalMatch) fixable.push(globalMatch);
      else unknown.push(ref);
    }
    return { unknownRefs: unknown, fixableRefs: fixable };
  }, [text, characters, allCharacters]);

  async function addToStory(charId: string) {
    const next = Array.from(new Set([...story.characters, charId]));
    try {
      await apiPatchStory(story.id, { characters: next });
      onCharactersPatched?.(next);
    } catch {
      toast.error('Charakter-hinzufügen fehlgeschlagen');
    }
  }

  function onChange(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const val = v.trim() === '' ? null : v;
      apiPatchStory(story.id, { storyText: val })
        .then(() => onStoryTextPatched(val))
        .catch(() => toast.error('Story-Text-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }

  const disabledReason =
    characters.length === 0 && fixableRefs.length === 0
      ? 'Bitte mindestens einen Charakter auswählen'
      : text.trim().length === 0
      ? 'Story-Text fehlt'
      : unknownRefs.length > 0
      ? `Unbekannte Referenz: @${unknownRefs[0]}`
      : fixableRefs.length > 0
      ? `Erst @${fixableRefs[0]!.name} zur Story hinzufügen`
      : null;

  async function doGenerate() {
    if (disabledReason) return;
    if (scenesExist) {
      const ok = window.confirm(
        'Alle bestehenden Szenen werden ersetzt — manuelle Bearbeitungen gehen verloren. Trotzdem fortfahren?'
      );
      if (!ok) return;
    }
    // Persist story_text before generating (in case the debounce timer
    // hasn't fired yet for the latest keystroke).
    if (story.story_text !== text) {
      try {
        await apiPatchStory(story.id, { storyText: text });
        onStoryTextPatched(text);
      } catch {
        toast.error('Story-Text-Speichern fehlgeschlagen');
        return;
      }
    }
    try {
      await onGenerate(text);
      toast.success('Szenen erzeugt');
    } catch (e) {
      toast.error('Sonnet-Fehler: ' + (e as Error).message);
    }
  }

  return (
    <section className="space-y-2 bg-[var(--surface-1)] rounded-lg p-4 border border-[var(--border)]">
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Beschreibe deine Story</span>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="Eine Frau (@Magdalena) geht durch einen Wald ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-sm"
        />
      </label>
      {fixableRefs.length > 0 && (
        <div className="text-xs text-amber-300 flex flex-wrap items-center gap-2">
          <span>
            Diese Charaktere sind global angelegt, aber nicht in dieser Story:
          </span>
          {fixableRefs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                void addToStory(c.id);
              }}
              className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded px-2 py-0.5 text-amber-100"
              title="Zur Story hinzufügen"
            >
              + @{c.name}
            </button>
          ))}
        </div>
      )}
      {unknownRefs.length > 0 && (
        <div className="text-xs text-red-400">
          Unbekannte Charakter-Referenzen:{' '}
          {unknownRefs.map((r) => `@${r}`).join(', ')}{' '}
          <span className="text-[var(--text-muted)]">
            (lege sie im Charaktere-Drawer an)
          </span>
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={doGenerate}
          disabled={disabledReason !== null || generating}
          title={disabledReason ?? undefined}
          className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {generating ? '... Sonnet arbeitet ...' : 'Mit KI aufteilen →'}
        </button>
      </div>
    </section>
  );
}
