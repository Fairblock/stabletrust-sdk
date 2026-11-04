import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { ConfidentialTransferClient } from "../src/confidential-client.js";
import { isWasmInitialized } from "../src/wasm-loader.js";

test("confidential clients retry a failed WASM load and share successful initialization", async () => {
  let unavailable = true;
  let reads = 0;
  const readFileSync = fs.readFileSync;
  fs.readFileSync = (path, ...args) => {
    if (String(path).endsWith("confidential_transfer_proof_generation_bg.wasm")) {
      reads += 1;
      if (unavailable) throw new Error("WASM asset temporarily unavailable");
    }
    return readFileSync(path, ...args);
  };
  syncBuiltinESMExports();

  try {
    const first = Object.create(ConfidentialTransferClient.prototype);
    const second = Object.create(ConfidentialTransferClient.prototype);
    const failed = await Promise.allSettled([first._getWasm(), second._getWasm()]);
    for (const result of failed) {
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /WASM asset temporarily unavailable/);
    }
    assert.equal(reads, 1, "concurrent clients share the failed attempt");
    assert.equal(isWasmInitialized(), false);

    unavailable = false;
    const third = Object.create(ConfidentialTransferClient.prototype);
    const modules = await Promise.all([
      first._getWasm(),
      second._getWasm(),
      third._getWasm(),
    ]);
    assert.equal(reads, 2, "concurrent retries perform one new asset read");
    assert.equal(isWasmInitialized(), true);
    assert.equal(modules[0], modules[1]);
    assert.equal(modules[0], modules[2]);
    assert.equal(typeof modules[0].generate_transfer_proof, "function");
    assert.equal(await first._getWasm(), modules[0]);
    assert.equal(reads, 2, "successful initialization remains cached");
  } finally {
    fs.readFileSync = readFileSync;
    syncBuiltinESMExports();
  }
});
