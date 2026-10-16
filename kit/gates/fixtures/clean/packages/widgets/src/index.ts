// An explicit package: it imports what its mayImport names, and is imported
// only by a package that names it.
import { createPriceSimulator } from "@fx/domain";

export const widgetSource = createPriceSimulator;
