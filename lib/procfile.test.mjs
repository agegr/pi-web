import assert from "node:assert/strict";
import test from "node:test";
import { parseProcfile } from "./procfile.ts";

test("Procfile preserves shell syntax, comments inside commands and colons", () => {
  assert.deepEqual(parseProcfile('\uFEFF# comment\r\n\r\nweb: PORT=3010 npm run dev -- --host http://localhost:3010\r\nworker: sh -c \'echo "# literal" | tee /tmp/out\'\r\n'), [
    { name: "web", command: "PORT=3010 npm run dev -- --host http://localhost:3010" },
    { name: "worker", command: 'sh -c \'echo "# literal" | tee /tmp/out\'' },
  ]);
});

test("invalid Procfiles locate the failing line and refuse duplicates or empty commands", () => {
  assert.throws(() => parseProcfile("# comment\nweb: npm run dev\nbroken"), /line 3/);
  assert.throws(() => parseProcfile("web: echo 1\nweb: echo 2"), /line 2: duplicate/);
  assert.throws(() => parseProcfile("web:  "), /line 1/);
  assert.throws(() => parseProcfile("# comments only"), /no processes/);
  assert.throws(() => parseProcfile("web: echo\0bad"), /line 1/);
});
