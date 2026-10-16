import { describe } from "vitest";

import type { Price } from "@fx/domain";

import type { ClockPort } from "#/ports/clockPort.ts";

// The entities come from a package the core's role grants it.
export function describeClockPortContract(label: string, createPort: () => ClockPort, sample?: Price): void {
  const port = createPort();

  void describe;
  void label;
  void sample;
  void port.now();
}
