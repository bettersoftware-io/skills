// The change under review: the price list shows the average of the mids under
// its rows, and works that average out itself. A total or an average is
// business meaning, which belongs in the core (question 4 of the review). No
// gate looks at it, and nothing in the starter's comments points at it.
//
// Run by fixture.sh in a project just created. It fails, so the run scores 0
// and says why, when the starter no longer has the line it changes.

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "packages/client-react/src/ui/PriceList.tsx";
const BEFORE = "      </tbody>\n";
const AFTER = [
  "      </tbody>",
  "      <tfoot>",
  "        <tr>",
  '          <th scope="row">Average</th>',
  "          <td>",
  "            {rows.length === 0",
  '              ? "–"',
  "              : (rows.reduce((total, row) => total + row.mid, 0) / rows.length).toFixed(4)}",
  "          </td>",
  "        </tr>",
  "      </tfoot>",
  "",
].join("\n");

const source = readFileSync(FILE, "utf8");

if (!source.includes(BEFORE)) {
  throw new Error(`${FILE} no longer holds the line this change follows: ${BEFORE.trim()}`);
}

writeFileSync(FILE, source.replace(BEFORE, AFTER));
