'use client';
import { useRef } from 'react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { MobileTabBar } from '@/components/Mobile/MobileTabBar';

export default function StudioPage() {
  const { engine } = useAudioEngine();
  // Canvas ref lives here so both Workspace (renders the Stage) and TopBar
  // (mounts the useVideoExporter hook) can reach the same DOM element.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)]">
      <TopBar engine={engine} canvasRef={canvasRef} />
      <Workspace engine={engine} canvasRef={canvasRef} />
      <MobileTabBar />
    </div>
  );
}
