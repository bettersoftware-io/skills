import type { Inbound, Outbound } from "@better-software/rx-ws-effects";
import { map, type Observable } from "rxjs";

import type { Price } from "@app/domain";
import { encodePrice } from "@app/shared";

/** What the server's effects need from the application. */
interface ServerContext {
  /** One feed, shared by every connection. */
  prices$: Observable<Price>;
}

/**
 * Sends every price of the shared feed to a connection, from the moment it
 * opens. The client asks for nothing, so the effect reads none of its
 * messages. A message the client may send gets an effect of its own, and
 * `combineEffects` runs them side by side.
 *
 * Its shape is the library's `WsEffect`: the connection's messages and the
 * context in, the messages to send out.
 */
export function streamPrices(
  _messages$: Observable<Inbound>,
  { prices$ }: ServerContext,
): Observable<Outbound> {
  return prices$.pipe(map(encodePrice));
}
