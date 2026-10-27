import type { AddressInfo } from "node:net";

import { createWsListener } from "@better-software/rx-ws-effects";
import { share } from "rxjs";
import { WebSocketServer } from "ws";

import type { PricePort } from "@app/domain";
import { WS_PATH } from "@app/shared";

import { streamPrices } from "./streamPrices.ts";
import { toSocket } from "./toSocket.ts";

export interface ServerOptions {
  /** 0 picks a free port. */
  port: number;
  prices: PricePort;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Streams prices to every client that connects. All connections share one
 * feed, so every client sees the same prices; the feed opens with the first
 * client and closes when the last one leaves.
 *
 * The server takes its price source as a port, like the client does, so a test
 * drives it by hand and production runs it on the simulator.
 *
 * What the server sends is written as effects (`streamPrices.ts`), run by
 * `@better-software/rx-ws-effects`. A failure stays in its connection: if the
 * feed fails, each client is dropped with code 1011, and the process carries
 * on.
 */
export function startServer({
  port,
  prices,
}: ServerOptions): Promise<RunningServer> {
  const server = new WebSocketServer({ port, path: WS_PATH });
  const serveConnection = createWsListener(streamPrices, {
    prices$: prices.prices().pipe(share()),
  });

  server.on("connection", (socket) => {
    serveConnection(toSocket(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      resolve({
        // A server listening on a TCP port always reports an address object.
        port: (server.address() as AddressInfo).port,
        close: () => {
          return new Promise<void>((closed) => {
            for (const client of server.clients) {
              client.terminate();
            }

            server.close(() => {
              closed();
            });
          });
        },
      });
    });
  });
}
