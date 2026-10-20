import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateAnonymousAccountId } from "../src/utils.js";

const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("README unlinkable flow uses a valid anonymous account ID", () => {
  const heading = "### Unlinkable Flow (AnonymousTransferClient)";
  const start = readme.indexOf(heading);
  assert.notEqual(start, -1, "unlinkable flow section must exist");

  const section = readme.slice(start);
  const match = section.match(/const accountId = "([^"]+)";/);
  assert.ok(match, "unlinkable flow must define accountId");
  assert.doesNotThrow(() => validateAnonymousAccountId(match[1]));
});
