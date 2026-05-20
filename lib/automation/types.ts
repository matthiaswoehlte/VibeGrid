export type Interpolation = 'linear' | 'step' | 'easeIn' | 'easeOut';

export interface AutomationPoint<T> {
  beat: number;
  value: T;
}

export interface AutomationCurve<T> {
  mode: 'automation';
  points: AutomationPoint<T>[];
  interpolation: Interpolation;
}

/** A parameter value: either a static T, or a curve over beats. */
export type StaticOrAuto<T> = T | AutomationCurve<T>;
