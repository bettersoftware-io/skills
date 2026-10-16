// The integration tier may import an explicit package without naming it.
import { widgetSource } from "@fx/widgets";

import { describeAgreement } from "./__testUtils__/describeAgreement.ts";

describeAgreement("widgets", widgetSource);
