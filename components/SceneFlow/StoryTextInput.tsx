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
  scenesExist,
  generating,
  onGenerate,
  onStoryTextPatched
}: {
  story: StoryRecord;
  characters: CharacterRecord[];
  scenesExist: boolean;
  generating: boolean;
  onGenerate(text: string): void | Promise<void>;
  onStoryTextPatched(text: string | null): void;
}) {
  const [text, setText] = useState(story.story_text ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setText(story.story_text ?? '');
  }, [story.id, story.story_text]);

  const { unknownRefs } = useMemo(() => {
    const known = new Set(characters.map((c) => c.name.toLowerCase()));
    const refs = Array.from(text.matchAll(RE_REF)).map((m) => m[1]!);
    const unknown = refs.filter((r) => !known.has(r.toLowerCase()));
    return { unknownRefs: Array.from(new Set(unknown)) };
  }, [text, characters]);

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
    characters.length === 0
      ? 'Bitte mindestens einen Charakter auswählen'
      : text.trim().length === 0
      ? 'Story-Text fehlt'
      : unknownRefs.length > 0
      ? `Unbekannte Referenz: @${unknownRefs[0]}`
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
      {unknownRefs.length > 0 && (
        <div className="text-xs text-red-400">
          Unbekannte Charakter-Referenzen:{' '}
          {unknownRefs.map((r) => `@${r}`).join(', ')}
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
