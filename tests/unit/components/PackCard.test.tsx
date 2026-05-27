import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackCard } from '@/components/PresetPacks/PackCard';
import type { PresetPack } from '@/lib/presets/types';

const MOCK_PACK: PresetPack = {
  id: 'mock',
  name: 'Mock Pack',
  description: '',
  category: 'Drop',
  tags: [],
  bpmReference: 128,
  bpmRange: [128, 145],
  recommendedBars: 4,
  source: 'built-in',
  fx: [
    {
      fxKind: 'ZoomPunch',
      params: {},
      automationCurves: {},
      displayTriggerLabel: '1/4',
      curveLabel: 'PUNCH',
      displayLabel: 'Z',
      enabled: true
    },
    {
      fxKind: 'RGBSplit',
      params: {},
      automationCurves: {},
      displayTriggerLabel: '1/2',
      curveLabel: 'RGB',
      displayLabel: 'R',
      enabled: false
    }
  ]
};

describe('PackCard', () => {
  it('renders pack name and FX-count summary', () => {
    render(
      <PackCard pack={MOCK_PACK} projectBpm={130} active={false} onSelect={() => {}} />
    );
    expect(screen.getByText('Mock Pack')).toBeTruthy();
    expect(screen.getByText(/2 FX/)).toBeTruthy();
    expect(screen.getByText(/1 active/)).toBeTruthy();
  });

  it('shows BPM badge in normal color when projectBpm is in range', () => {
    const { container } = render(
      <PackCard pack={MOCK_PACK} projectBpm={130} active={false} onSelect={() => {}} />
    );
    const bpmLabel = screen.getByText('128 BPM');
    expect(bpmLabel.className).not.toContain('orange');
    expect(bpmLabel.getAttribute('title')).toBeNull();
    // Smoke: rendered without crash.
    expect(container).toBeTruthy();
  });

  it('shows orange warning when projectBpm is below range', () => {
    render(
      <PackCard pack={MOCK_PACK} projectBpm={90} active={false} onSelect={() => {}} />
    );
    const bpmLabel = screen.getByText('128 BPM');
    expect(bpmLabel.className).toContain('orange');
    expect(bpmLabel.getAttribute('title')).toContain('slower');
  });

  it('shows orange warning + "faster" hint when projectBpm is above range', () => {
    render(
      <PackCard pack={MOCK_PACK} projectBpm={160} active={false} onSelect={() => {}} />
    );
    const bpmLabel = screen.getByText('128 BPM');
    expect(bpmLabel.getAttribute('title')).toContain('faster');
  });

  it('Preview button is disabled with "coming soon" tooltip', () => {
    render(
      <PackCard pack={MOCK_PACK} projectBpm={130} active={false} onSelect={() => {}} />
    );
    const previewBtn = screen.getByLabelText('Preview (coming soon)');
    expect(previewBtn.hasAttribute('disabled')).toBe(true);
    expect(previewBtn.getAttribute('title')).toBe('Preview coming soon');
  });

  it('onSelect fires when the card body is clicked', async () => {
    const handle = vi.fn();
    render(
      <PackCard pack={MOCK_PACK} projectBpm={130} active={false} onSelect={handle} />
    );
    screen.getByText('Mock Pack').closest('button')!.click();
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
