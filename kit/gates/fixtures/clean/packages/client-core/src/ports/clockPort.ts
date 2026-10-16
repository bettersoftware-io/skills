// A port held by a core, not by the domain.
export interface ClockPort {
  now(): number;
}
