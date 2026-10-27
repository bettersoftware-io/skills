import type { Outbound, Socket } from "@better-software/rx-ws-effects";
import { fromEvent, map, NEVER, take } from "rxjs";
import type { WebSocket } from "ws";

/**
 * Adapts one `ws` connection to the `Socket` the effects run on. The effects
 * never see the transport, so this is the one place that knows it.
 *
 * The client sends nothing yet, so no frame is read. The first message it
 * sends is parsed here into the library's `Inbound`, and a frame that does not
 * parse is dropped, so that no effect ever sees one.
 */
export function toSocket(ws: WebSocket): Socket {
  // Without a listener, one client's protocol error would end the process.
  ws.on("error", () => {
    ws.terminate();
  });

  return {
    messages$: NEVER,
    closed$: fromEvent(ws, "close").pipe(
      take(1),
      map(() => {
        return undefined;
      }),
    ),
    send: (message: Outbound) => {
      ws.send(JSON.stringify(message));
    },
    // Called when the connection's effects fail, so the client sees it drop
    // and can reconnect, instead of waiting on prices that will not come.
    close: () => {
      ws.close(1011, "internal error");
    },
  };
}
