export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
}
