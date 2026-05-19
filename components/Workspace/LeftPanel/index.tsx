'use client';
import { useState } from 'react';
import { MediaLibrary } from './MediaLibrary';
import { FxLibrary } from './FxLibrary';
import { LayersList } from './LayersList';

type Tab = 'media' | 'fx' | 'layers';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="h-full flex flex-col">
      <nav className="flex border-b border-[var(--border)]">
        {(['media', 'fx', 'layers'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 h-9 text-xs uppercase tracking-wider ${
              tab === t ? 'text-[var(--text)] border-b-2 border-[var(--a1)]' : 'text-[var(--text-dim)]'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'media' && <MediaLibrary />}
        {tab === 'fx' && <FxLibrary />}
        {tab === 'layers' && <LayersList />}
      </div>
    </div>
  );
}
