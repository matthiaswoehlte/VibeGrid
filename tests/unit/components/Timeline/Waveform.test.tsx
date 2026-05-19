import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Waveform } from '@/components/Workspace/Timeline/Waveform';

describe('Waveform', () => {
  it('returns null without peaks', () => {
    const { container } = render(<Waveform peaks={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG path from peaks', () => {
    const min = new Float32Array([-0.5, -0.2, -0.8]);
    const max = new Float32Array([0.5, 0.2, 0.8]);
    const { container } = render(<Waveform peaks={{ min, max }} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toContain('M');
  });
});
