import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import localRules from '../../../eslint-local-rules.js';

/**
 * Plan 10 — verify the custom ESLint rules behave correctly so regressions
 * (mutated store actions bypassing the recorder) get caught at CI lint
 * time, not after someone breaks Undo for everyone.
 */
const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
});

describe('local-rules/no-direct-set-state', () => {
  it('flags useAppStore.setState() and accepts recordingSet()', () => {
    tester.run(
      'no-direct-set-state',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (localRules as any)['no-direct-set-state'],
      {
        valid: [
          {
            code: `useAppStore.getState().recordingSet('Test', (s) => { s.x = 1; });`
          },
          {
            code: `useAppStore.getState().timelineActions.addClip({ id: 'x' });`
          },
          {
            code: `useCurrentProject.setState({ projectId: null });`
          }
        ],
        invalid: [
          {
            code: `useAppStore.setState({ timeline: empty });`,
            errors: [{ messageId: 'directSetState' }]
          },
          {
            code: `useAppStore.setState((s) => ({ ...s, x: 1 }));`,
            errors: [{ messageId: 'directSetState' }]
          }
        ]
      }
    );
    expect(true).toBe(true);
  });
});

describe('local-rules/no-bare-set-in-store', () => {
  it('flags bare set() in the AppStore slice', () => {
    tester.run(
      'no-bare-set-in-store',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (localRules as any)['no-bare-set-in-store'],
      {
        valid: [
          {
            code: `get().recordingSet('label', (s) => { s.x = 1; });`
          },
          {
            // Calling .set on an object (chain) is fine — it's not bare.
            code: `someObject.set({ x: 1 });`
          }
        ],
        invalid: [
          {
            code: `set({ x: 1 });`,
            errors: [{ messageId: 'bareSet' }]
          },
          {
            code: `set((s) => { s.x = 1; });`,
            errors: [{ messageId: 'bareSet' }]
          }
        ]
      }
    );
    expect(true).toBe(true);
  });
});
