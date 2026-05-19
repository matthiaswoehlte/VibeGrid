'use client';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { MobileTabBar } from '@/components/Mobile/MobileTabBar';

export default function StudioPage() {
  const { engine } = useAudioEngine();
  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)]">
      <TopBar engine={engine} />
      <Workspace engine={engine} />
      <MobileTabBar />
    </div>
  );
}
