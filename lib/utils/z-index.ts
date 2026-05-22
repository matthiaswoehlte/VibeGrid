// Single source of truth for layered-element z-index values.
//
// Layer ordering (back → front):
//   10  Canvas Stage
//   20  Timeline
//   30  Mobile TabBar
//   40  Drawer backdrop (semi-transparent overlay behind sheet panels)
//   50  Drawer / InspectorSheet panel
//   60  Modals (e.g. AutomationEditorModal)
//
// Use the matching Tailwind class (`z-10`, `z-20`, …) at the call site
// and reference these constants in a comment for traceability. When
// adding a new layered component, pick the closest constant or add
// a new one here with a one-line comment.

export const Z_STAGE = 10;
export const Z_TIMELINE = 20;
export const Z_TABBAR = 30;
export const Z_DRAWER_BACKDROP = 40;
export const Z_DRAWER_PANEL = 50;
export const Z_MODAL = 60;
