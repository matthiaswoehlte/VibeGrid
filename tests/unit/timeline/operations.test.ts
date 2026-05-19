import { describe, it, expect } from 'vitest';
import { OperationError } from '@/lib/timeline/operations';

describe('OperationError', () => {
  it('is throwable, identifiable via instanceof, and carries a code', () => {
    const err = new OperationError('OVERLAP', 'Clip overlaps existing clip');
    expect(err).toBeInstanceOf(OperationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OVERLAP');
    expect(err.message).toBe('Clip overlaps existing clip');
    expect(err.name).toBe('OperationError');
  });
});
