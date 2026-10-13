import { createServer } from "node:http";
import { findOrder, totalOf } from "./orders.ts";

const server = createServer((request, response) => {
  const id = /^\/orders\/([\w-]+)$/.exec(request.url ?? "")?.[1];
  const order = id === undefined ? undefined : findOrder(id);

  if (order === undefined) {
    response.writeHead(404).end();

    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ...order, total: totalOf(order) }));
});

server.listen(4000);
