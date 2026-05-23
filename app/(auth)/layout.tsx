export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-6">
        {children}
      </div>
    </div>
  );
}
