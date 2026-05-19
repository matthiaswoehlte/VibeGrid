import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Bomb(): JSX.Element {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary name="Test">
        <div>child</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('renders fallback with name when a child throws', () => {
    // Silence the expected React error log
    const origError = console.error;
    console.error = () => undefined;
    try {
      render(
        <ErrorBoundary name="Stage">
          <Bomb />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Stage/i)).toBeInTheDocument();
    } finally {
      console.error = origError;
    }
  });
});
