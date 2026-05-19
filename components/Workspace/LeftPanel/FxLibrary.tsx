'use client';
import { listPlugins } from '@/lib/renderer/registry';
import { registerBuiltInPlugins } from '@/lib/fx';

// Idempotent — safe to call at module top.
registerBuiltInPlugins();

export function FxLibrary() {
  const plugins = listPlugins();
  return (
    <ul className="space-y-1">
      {plugins.map((p) => (
        <li
          key={p.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-vibegrid-fx', p.id);
          }}
          className="px-2 py-1.5 rounded bg-[var(--surface-2)] text-sm hover:bg-[var(--surface-3)] cursor-grab active:cursor-grabbing"
        >
          {p.name} <span className="text-[var(--text-dim)] text-xs">({p.kind})</span>
        </li>
      ))}
    </ul>
  );
}
