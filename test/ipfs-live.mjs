// OPT-IN live IPFS integration test , NOT part of `npm test`
//
// This file instead hits the *real* self-hosted Kubo server to prove the upload endpoint
// and read gateway actually round-trip a proof blob. It needs credentials, so it is:
//   - excluded from the default `npm test` glob (filename is `.mjs`, not `.test.mjs`)
//   - run only via `npm run test:live`
//
// Configure by copying .env.example -> .env and setting:
//   STABLETRUST_IPFS_UPLOAD_URL, STABLETRUST_IPFS_GATEWAY_URL, STABLETRUST_IPFS_API_KEY
import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uploadBytesToIpfs } from "../src/utils.js";

const UPLOAD_URL = process.env.STABLETRUST_IPFS_UPLOAD_URL;
const API_KEY = process.env.STABLETRUST_IPFS_API_KEY || null;
// Fall back to the upload endpoint's origin if no explicit gateway is configured.
const GATEWAY_URL =
  process.env.STABLETRUST_IPFS_GATEWAY_URL ||
  (UPLOAD_URL ? new URL(UPLOAD_URL).origin : null);

const skip = UPLOAD_URL
  ? false
  : "STABLETRUST_IPFS_UPLOAD_URL not set - copy .env.example to .env to run the live IPFS test";

const uploadOpts = { uploadUrl: UPLOAD_URL, apiKey: API_KEY };
const fetchBack = async (cid) => {
  const res = await fetch(`${GATEWAY_URL}/ipfs/${cid}`);
  if (!res.ok) throw new Error(`gateway fetch ${cid} failed: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
};

describe("live IPFS round-trip (self-hosted Kubo)", { skip }, () => {
  it("uploads proof bytes and fetches identical bytes back from the gateway", { timeout: 20_000 }, async () => {
    const payload = new TextEncoder().encode(`stabletrust-live ${new Date().toISOString()}`);
    const cid = await uploadBytesToIpfs(payload, "roundtrip-proof.bin", uploadOpts);
    assert.ok(cid && /^baf[0-9a-z]+$/.test(cid), `unexpected CID: ${cid}`);
    assert.deepEqual(await fetchBack(cid), payload, "gateway bytes must match what we uploaded");
  });

  it("is content-addressed: identical bytes always yield the identical CID", { timeout: 20_000 }, async () => {
    // Same input -> same CID is what lets the on-chain CID bind to exact proof bytes.
    const bytes = new TextEncoder().encode("stabletrust-ipfs-live-fixture-v1");
    const KNOWN_CID = "bafkreig44k2mp7rwa6kgwhnmjy7hbrkilnquuga2yyun5eb5eml7uyksaa";
    assert.equal(await uploadBytesToIpfs(bytes, "fixture.bin", uploadOpts), KNOWN_CID);
    assert.equal(await uploadBytesToIpfs(bytes, "fixture.bin", uploadOpts), KNOWN_CID);
    assert.deepEqual(await fetchBack(KNOWN_CID), bytes);
  });
});
