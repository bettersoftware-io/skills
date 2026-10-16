import { useState } from "react";

export function useCard(): number {
  return useState(1)[0];
}
