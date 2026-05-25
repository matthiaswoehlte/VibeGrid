'use client';
import { useEffect } from 'react';

/**
 * Plan 8c — fullscreen image overlay.
 *
 * Triggered by clicking a generated scene image. Closes on Esc, on
 * background click, or via the × button. Pointer events (per project
 * convention — not click) for the close button to keep touch parity.
 */
export function ImageViewer({
  url,
  alt,
  onClose
}: {
  url: string;
  alt: string;
  onClose(): void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bild-Vorschau"
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-8"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onPointerDown={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl"
        aria-label="Schließen"
      >
        ×
      </button>
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded shadow-2xl"
      />
    </div>
  );
}
