import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { AnonymousTransferClient } from "../src/index.js";

const sockets = new Set();
let server;
let client;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/v1/requests/hang") {
      req.resume();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      status: req.url === "/v1/requests/completed" ? "completed" : "accepted",
    }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  client = new AnonymousTransferClient({
    fairycloakUrl: `http://127.0.0.1:${port}`,
    rpcUrl: "http://127.0.0.1:1",
    chainId: 84532,
  });
});

after(async () => {
  client.provider.destroy();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe("waitForRequest total timeout", () => {
  it("returns a terminal response before the deadline", async () => {
    const result = await client.waitForRequest("completed", {
      timeoutMs: 500,
      pollIntervalMs: 300,
    });
    assert.equal(result.status, "completed");
  });

  it("caps polling sleep to the remaining total deadline", async () => {
    const started = performance.now();
    await assert.rejects(
      client.waitForRequest("pending", {
        timeoutMs: 60,
        pollIntervalMs: 300,
      }),
      /after 60ms/,
    );
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 180, `60ms timeout took ${Math.round(elapsedMs)}ms`);
  });

  it("aborts an in-flight status request at the total deadline", async () => {
    const started = performance.now();
    const pending = client.waitForRequest("hang", {
      timeoutMs: 60,
      pollIntervalMs: 10,
    });
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        (error) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve("still-pending"), 180)),
    ]);
    assert.notEqual(outcome, "still-pending");
    assert.match(outcome.message, /after 60ms/);
    assert.ok(performance.now() - started < 180);
  });

  it("rejects invalid timeout options before making a request", async () => {
    for (const options of [
      { timeoutMs: -1 },
      { timeoutMs: Number.NaN },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { pollIntervalMs: -1 },
      { pollIntervalMs: Number.NaN },
      { pollIntervalMs: Number.POSITIVE_INFINITY },
    ]) {
      await assert.rejects(
        client.waitForRequest("completed", options),
        /must be a finite, non-negative number/,
      );
    }
  });
});
