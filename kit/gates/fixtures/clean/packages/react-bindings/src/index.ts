import { createWsPrice } from "@fx/client-core";
import { widgetSource } from "@fx/widgets";
import { useState } from "react";

export function createViewModel(): { priceSource: unknown } {
  void useState;
  void widgetSource;

  return { priceSource: createWsPrice() };
}
