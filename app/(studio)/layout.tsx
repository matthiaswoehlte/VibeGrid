import { Toaster } from 'sonner';
import { AutoSaveMount } from '@/components/AutoSaveMount';
import { SoundManifestLoader } from '@/components/SoundManifestLoader';
import { UserSessionLoader } from '@/components/UserSessionLoader';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      {children}
      <AutoSaveMount />
      <SoundManifestLoader />
      <UserSessionLoader />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)'
          }
        }}
      />
    </div>
  );
}
