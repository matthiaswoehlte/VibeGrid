'use strict';

/**
 * Plan 10 — Undo/Redo guardrails.
 *
 * Two rules:
 *
 * 1. `no-direct-set-state` — bans `useAppStore.setState(...)` ANYWHERE
 *    (components, hooks, lib code). Used everywhere via the global
 *    override in .eslintrc.json.
 *
 * 2. `no-bare-set-in-store` — bans bare `set(...)` inside the AppStore
 *    slice files (lib/store/timeline-slice.ts etc.) where `set` is the
 *    Zustand setter. Whitelisted in recording-set.ts + history-actions.ts
 *    (they LEGITIMATELY bypass the recorder).
 *    NOT applied to other Zustand stores (useCurrentProject) — those
 *    have their own slices and don't share the AppStore history.
 *
 * Bypass mechanism: `useAppStore.getState().recordingSet(label, mut, { skip: true })`
 * is the supported escape hatch for transient UI state (with an inline
 * comment explaining why). The rules above do not flag it.
 */
module.exports = {
  'no-direct-set-state': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'forbid useAppStore.setState() — use recordingSet() instead'
      },
      schema: [],
      messages: {
        directSetState:
          'Direct useAppStore.setState() bypasses the Undo/Redo history. ' +
          'Use useAppStore.getState().recordingSet(label, mutator, opts) instead. ' +
          'For UI-only mutations, pass { skip: true } with an inline justification.'
      }
    },
    create(context) {
      return {
        CallExpression(node) {
          const callee = node.callee;
          if (
            callee.type === 'MemberExpression' &&
            !callee.computed &&
            callee.object &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'useAppStore' &&
            callee.property &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'setState'
          ) {
            context.report({ node, messageId: 'directSetState' });
          }
        }
      };
    }
  },

  'no-bare-set-in-store': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'forbid bare set() inside AppStore slices — use get().recordingSet()'
      },
      schema: [],
      messages: {
        bareSet:
          'Bare set() in this AppStore slice bypasses the Undo/Redo history. ' +
          'Use get().recordingSet(label, mutator, opts) instead. ' +
          'See docs/architecture/undo-stack.md for the migration table.'
      }
    },
    create(context) {
      return {
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type === 'Identifier' && callee.name === 'set') {
            context.report({ node, messageId: 'bareSet' });
          }
        }
      };
    }
  }
};
