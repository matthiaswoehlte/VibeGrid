import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Waveform } from '@/components/Workspace/Timeline/Waveform';

describe('Waveform', () => {
  it('renders nothing when peaks is null', () => {
    const { container } = render(<Waveform peaks={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when peaks is empty', () => {
    const { container } = render(<Waveform peaks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a path with M…L commands from peaks (worker tuple format)', () => {
    const { container } = render(
      <Waveform
        peaks={[
          [-0.5, 0.5],
          [-0.3, 0.3]
        ]}
        width={100}
        height={50}
      />
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M /);
    expect(path?.getAttribute('d')).toMatch(/L /);
  });
});
