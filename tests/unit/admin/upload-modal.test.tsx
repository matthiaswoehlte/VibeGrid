import { describe, it, expect } from 'vitest';
import { applyEntryEdit } from '@/app/admin/sounds/UploadModal';
import type { SoundManifest } from '@/lib/sounds/types';

const M: SoundManifest = {
  version: 3,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      sounds: [
        {
          id: 'heavy-01',
          label: 'Heavy',
          url: 'sfx/braams/heavy-01.mp3',
          duration: 2.4,
          tags: ['dark']
        }
      ]
    },
    { id: 'whoosh', label: 'Whoosh', sounds: [] }
  ]
};

describe('applyEntryEdit (UploadModal edit-mode helper)', () => {
  it('updates label + tags + license + bpm in place when source === target', () => {
    const result = applyEntryEdit({
      manifest: M,
      entryId: 'heavy-01',
      sourceCategoryId: 'braams',
      targetCategoryId: 'braams',
      edits: { label: 'Heavy Braam', tags: ['dark', 'cinematic'], license: 'CC0', bpm: 110 }
    });
    const cat = result.categories.find((c) => c.id === 'braams')!;
    expect(cat.sounds).toHaveLength(1);
    const entry = cat.sounds[0];
    expect(entry.id).toBe('heavy-01');
    expect(entry.label).toBe('Heavy Braam');
    expect(entry.tags).toEqual(['dark', 'cinematic']);
    expect(entry.license).toBe('CC0');
    expect(entry.bpm).toBe(110);
    // URL stays — no MP3 move on edit.
    expect(entry.url).toBe('sfx/braams/heavy-01.mp3');
  });

  it('moves an entry between categories when source !== target', () => {
    const result = applyEntryEdit({
      manifest: M,
      entryId: 'heavy-01',
      sourceCategoryId: 'braams',
      targetCategoryId: 'whoosh',
      edits: { label: 'Heavy' }
    });
    expect(result.categories.find((c) => c.id === 'braams')?.sounds).toHaveLength(0);
    expect(result.categories.find((c) => c.id === 'whoosh')?.sounds).toHaveLength(1);
    expect(result.categories.find((c) => c.id === 'whoosh')?.sounds[0].id).toBe(
      'heavy-01'
    );
    expect(result.categories.find((c) => c.id === 'whoosh')?.sounds[0].url).toBe(
      'sfx/braams/heavy-01.mp3'
    );
  });

  it('creates the target category on the fly when it does not exist', () => {
    const result = applyEntryEdit({
      manifest: M,
      entryId: 'heavy-01',
      sourceCategoryId: 'braams',
      targetCategoryId: 'kick',
      edits: { label: 'Heavy' }
    });
    const created = result.categories.find((c) => c.id === 'kick');
    expect(created).toBeDefined();
    expect(created?.label).toBe('Kick');
    expect(created?.sounds.map((s) => s.id)).toEqual(['heavy-01']);
  });

  it('is a no-op when the entry id is unknown', () => {
    const result = applyEntryEdit({
      manifest: M,
      entryId: 'does-not-exist',
      sourceCategoryId: 'braams',
      targetCategoryId: 'whoosh',
      edits: { label: 'Nope' }
    });
    expect(result).toBe(M);
  });
});
