export function RecIndicator({ active = false }: { active?: boolean }) {
  return (
    <div
      aria-label={active ? 'Recording' : 'Idle'}
      className={`h-2 w-2 rounded-full ${active ? 'bg-red-500 animate-pulse' : 'bg-[var(--surface-3)]'}`}
    />
  );
}
