import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MiniCurve } from '@/components/PresetPacks/MiniCurve';

describe('MiniCurve', () => {
  it('renders an SVG with a polyline of the given points', () => {
    const { container } = render(
      <MiniCurve
        points={[
          { beat: 0, value: 1 },
          { beat: 0.5, value: 0.5 },
          { beat: 1, value: 0 }
        ]}
        color="#a86bff"
        label="ENV"
      />
    );
    const poly = container.querySelector('polyline');
    expect(poly).toBeTruthy();
    expect(poly?.getAttribute('stroke')).toBe('#a86bff');
    // Three points → at least 2 commas in the points string.
    const pts = poly?.getAttribute('points') ?? '';
    expect(pts.split(' ').length).toBe(3);
  });

  it('renders the label as SVG text', () => {
    const { container } = render(
      <MiniCurve
        points={[
          { beat: 0, value: 0.5 },
          { beat: 1, value: 0 }
        ]}
        color="#2ee0d0"
        label="PULSE"
      />
    );
    const text = container.querySelector('text');
    expect(text?.textContent).toBe('PULSE');
  });

  it('renders an empty SVG with no polyline when points array is empty', () => {
    const { container } = render(
      <MiniCurve points={[]} color="#ffffff" label="X" />
    );
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
