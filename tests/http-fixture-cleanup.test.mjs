import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { closeServer } from "./support/http-server.cjs";

test("HTTP fixtures close Chromium preconnections before an HTTP request arrives", { timeout: 5_000 }, async (t) => {
  const server = http.createServer((_request, response) => response.end("ok"));
  let socket;
  t.after(() => {
    socket?.destroy();
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const accepted = once(server, "connection");
  socket = net.createConnection(server.address().port, "127.0.0.1");
  await Promise.all([accepted, once(socket, "connect")]);

  const disconnected = once(socket, "close");
  await closeServer(server);
  await disconnected;
  assert.equal(server.listening, false);
  assert.equal(socket.destroyed, true);
});
