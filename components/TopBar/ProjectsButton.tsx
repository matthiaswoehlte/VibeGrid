'use client';
import { useState } from 'react';
import { ProjectListDrawer } from '@/components/Studio/ProjectListDrawer';

export function ProjectsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-7 px-2 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors border border-[var(--border)]"
        title="Projekte"
      >
        Projekte
      </button>
      <ProjectListDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
