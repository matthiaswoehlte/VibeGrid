'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  apiListTtsVoices,
  apiTtsPreview,
  type TtsVoice
} from '@/lib/sceneflow/api-client';
import type { VoiceProvider } from '@/lib/sceneflow/types';

const DEFAULT_TEST_TEXT = 'Hallo, ich bin eine Beispielstimme.';

type PickerProvider = 'edge' | 'elevenlabs';

export function VoicePicker({
  provider,
  voiceId,
  testText,
  onChange
}: {
  /** Current provider — 'azure' falls back to 'edge' in the picker UI. */
  provider: VoiceProvider | null;
  voiceId: string | null;
  testText: string | null;
  onChange(next: {
    provider: VoiceProvider | null;
    voiceId: string | null;
    testText: string | null;
  }): void;
}) {
  const pickerProvider: PickerProvider =
    provider === 'elevenlabs' ? 'elevenlabs' : 'edge';

  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const text = testText ?? '';

  // Fetch voice list whenever provider changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setVoices([]);
    apiListTtsVoices(pickerProvider)
      .then(({ voices }) => {
        if (!cancelled) setVoices(voices);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = (e as Error).message;
        if (msg.includes('503')) {
          setLoadError(
            pickerProvider === 'elevenlabs'
              ? 'ELEVENLABS_API_KEY ist auf dem Server nicht gesetzt.'
              : msg
          );
        } else {
          setLoadError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerProvider]);

  // Group voices for display
  const groupedVoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? voices.filter(
          (v) =>
            v.id.toLowerCase().includes(q) ||
            v.name.toLowerCase().includes(q) ||
            (v.locale ?? '').toLowerCase().includes(q)
        )
      : voices;
    const groups = new Map<string, TtsVoice[]>();
    for (const v of filtered) {
      const key =
        pickerProvider === 'edge' ? v.locale ?? 'unknown' : v.category ?? 'voices';
      const list = groups.get(key) ?? [];
      list.push(v);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [voices, query, pickerProvider]);

  function switchProvider(p: PickerProvider) {
    if (p === pickerProvider) return;
    onChange({ provider: p, voiceId: null, testText });
  }

  function pickVoice(id: string) {
    onChange({ provider: pickerProvider, voiceId: id, testText });
  }

  function patchTestText(v: string) {
    onChange({
      provider: pickerProvider,
      voiceId,
      testText: v.trim() === '' ? null : v
    });
  }

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlaying(false);
  }

  // Cleanup on unmount
  useEffect(() => () => stop(), []);

  async function play() {
    if (!voiceId) {
      toast.error('Bitte zuerst eine Stimme auswählen');
      return;
    }
    const sampleText = text.trim() === '' ? DEFAULT_TEST_TEXT : text;
    stop();
    setPlaying(true);
    try {
      const blob = await apiTtsPreview({
        provider: pickerProvider,
        voiceId,
        text: sampleText
      });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stop();
      audio.onerror = () => {
        toast.error('Audio-Wiedergabe fehlgeschlagen');
        stop();
      };
      await audio.play();
    } catch (e) {
      toast.error('TTS-Fehler: ' + (e as Error).message);
      stop();
    }
  }

  return (
    <div className="space-y-2">
      {/* Provider toggle */}
      <div className="flex gap-2">
        {(['edge', 'elevenlabs'] as PickerProvider[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => switchProvider(p)}
            className={
              'text-xs px-3 py-1 rounded border ' +
              (pickerProvider === p
                ? 'bg-[var(--a1)] text-white border-[var(--a1)]'
                : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-3)]')
            }
          >
            {p === 'edge' ? 'Edge TTS (frei)' : 'ElevenLabs'}
          </button>
        ))}
      </div>

      {/* Search + voice list */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Stimme suchen…"
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
      />

      {loading && (
        <div className="text-xs text-[var(--text-dim)]">Lade Stimmen…</div>
      )}
      {loadError && (
        <div className="text-xs text-red-400">{loadError}</div>
      )}
      {!loading && !loadError && voices.length === 0 && (
        <div className="text-xs text-[var(--text-dim)]">
          Keine Stimmen verfügbar.
        </div>
      )}

      {!loading && !loadError && voices.length > 0 && (
        <ul className="max-h-48 overflow-y-auto bg-[var(--surface-2)] border border-[var(--border)] rounded">
          {groupedVoices.map(([groupName, items]) => (
            <li key={groupName}>
              <div className="sticky top-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--surface-1)] px-2 py-1 border-b border-[var(--border)]">
                {groupName} ({items.length})
              </div>
              <ul>
                {items.map((v) => {
                  const isPicked = v.id === voiceId;
                  const badgeText =
                    pickerProvider === 'edge'
                      ? v.gender === 'Male'
                        ? 'M'
                        : v.gender === 'Female'
                        ? 'F'
                        : '?'
                      : v.labels?.gender
                      ? v.labels.gender[0]!.toUpperCase()
                      : '';
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => pickVoice(v.id)}
                        className={
                          'w-full flex items-center gap-2 text-left px-2 py-1 text-xs ' +
                          (isPicked
                            ? 'bg-[var(--a1)]/30 text-[var(--text)]'
                            : 'text-[var(--text)] hover:bg-[var(--surface-3)]')
                        }
                      >
                        <span className="flex-1 truncate">
                          {v.name}
                          <span className="text-[var(--text-muted)] block text-[10px]">
                            {v.id}
                          </span>
                        </span>
                        {badgeText && (
                          <span className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] px-1 rounded">
                            {badgeText}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {voiceId && (
        <div className="text-[10px] text-[var(--text-muted)]">
          Ausgewählt: <span className="text-[var(--text)]">{voiceId}</span>
        </div>
      )}

      {/* Test text + play */}
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Test-Text</span>
        <textarea
          value={text}
          onChange={(e) => patchTestText(e.target.value)}
          rows={2}
          placeholder={DEFAULT_TEST_TEXT}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
        />
      </label>
      <div className="flex justify-end gap-2">
        {playing && (
          <button
            type="button"
            onClick={stop}
            className="text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] px-3 py-1 rounded border border-[var(--border)]"
          >
            ⏹ Stopp
          </button>
        )}
        <button
          type="button"
          onClick={play}
          disabled={!voiceId || playing}
          className="text-xs bg-[var(--a1)] text-white px-3 py-1 rounded disabled:opacity-50"
        >
          {playing ? '🔊 Spielt…' : '▶ Stimme testen'}
        </button>
      </div>
    </div>
  );
}
