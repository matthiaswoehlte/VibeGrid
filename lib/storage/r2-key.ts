import type { MediaKind } from './types';

export interface BuildR2KeyInput {
  userId: string;
  projectId: string;
  kind: MediaKind;
  id: string;
  ext: string;
}

function assertSafeSegment(segment: string, fieldName: string): void {
  if (segment.length === 0) {
    throw new Error(`buildR2Key: ${fieldName} must not be empty`);
  }
  if (segment.includes('/') || segment.includes('..') || segment.includes('\\')) {
    throw new Error(`buildR2Key: ${fieldName} segment contains unsafe characters: ${segment}`);
  }
}

export function buildR2Key(input: BuildR2KeyInput): string {
  const { userId, projectId, kind, id, ext } = input;
  assertSafeSegment(userId, 'userId');
  assertSafeSegment(projectId, 'projectId');
  assertSafeSegment(id, 'id');
  assertSafeSegment(ext, 'ext');
  return `${userId}/${projectId}/${kind}/${id}.${ext}`;
}
