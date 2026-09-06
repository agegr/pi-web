#!/usr/bin/env node

import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  indexedSessionMetadata,
  reconcileSessionFiles,
} from "../lib/session-index-core.mts";

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const options = { samples: 7, sessions: 24, messages: 12, largeBytes: 2 * 1024 * 1024 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--dir") {
      if (!value) throw new Error("--dir requires a path");
      options.dir = resolve(value);
      index += 1;
    } else if (flag === "--samples") {
      options.samples = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--sessions") {
      options.sessions = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--messages") {
      options.messages = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--large-bytes") {
      options.largeBytes = parsePositiveInteger(value, flag);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function summarize(values) {
  return {
    p50: Number(percentile(values, 0.5).toFixed(2)),
    p95: Number(percentile(values, 0.95).toFixed(2)),
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
  };
}

function sessionHeader(id, cwd, parentSession) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd,
    ...(parentSession ? { parentSession } : {}),
  };
}

async function createSyntheticDataset(options) {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-session-baseline-"));
  const paths = [];
  for (let sessionIndex = 0; sessionIndex < options.sessions; sessionIndex += 1) {
    const id = `baseline-${String(sessionIndex).padStart(4, "0")}`;
    const filePath = join(directory, `${id}.jsonl`);
    const parentSession = sessionIndex > 0 && sessionIndex % 5 === 0 ? paths[sessionIndex - 1] : undefined;
    const entries = [sessionHeader(id, `/tmp/pi-web-baseline/project-${sessionIndex % 4}`, parentSession)];
    let parentId = null;
    for (let messageIndex = 0; messageIndex < options.messages; messageIndex += 1) {
      const entryId = `${sessionIndex}-${messageIndex}`;
      const role = messageIndex % 2 === 0 ? "user" : "assistant";
      entries.push({
        type: "message",
        id: entryId,
        parentId,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, messageIndex + 1)).toISOString(),
        message: {
          role,
          ...(role === "assistant" ? { provider: "baseline", model: "baseline" } : {}),
          content: role === "user" && sessionIndex === 0 && messageIndex === 0
            ? [
                { type: "text", text: "baseline image message" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
              ]
            : `baseline message ${sessionIndex}/${messageIndex}`,
        },
      });
      parentId = entryId;
    }
    if (sessionIndex === options.sessions - 1) {
      entries.push({
        type: "message",
        id: `${sessionIndex}-large`,
        parentId,
        timestamp: "2026-01-01T00:10:00.000Z",
        message: {
          role: "assistant",
          provider: "baseline",
          model: "baseline",
          content: [{ type: "text", text: "x".repeat(options.largeBytes) }],
        },
      });
    }
    await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
    paths.push(filePath);
  }

  await writeFile(
    join(directory, "damaged-lines.jsonl"),
    `${JSON.stringify(sessionHeader("damaged-lines", "/tmp/pi-web-baseline/damaged"))}\n{not-json}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "invalid-session.jsonl"),
    `${JSON.stringify({ type: "message", id: "invalid", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "invalid" } })}\n`,
    { mode: 0o600 },
  );
  return directory;
}

async function datasetStats(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  let bytes = 0;
  for (const file of files) bytes += (await stat(join(directory, file))).size;
  return { jsonlFiles: files.length, bytes };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const generated = !options.dir;
  const directory = options.dir ?? await createSyntheticDataset(options);

  try {
    const dataset = await datasetStats(directory);
    const listMs = [];
    const indexColdMs = [];
    const indexWarmMs = [];
    const serializeMs = [];
    const sessionFiles = (await readdir(directory))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(directory, name));
    let validSessions = 0;
    let indexedValidSessions = 0;
    let sdkIndexParity = false;
    let responseBytes = 0;

    for (let sample = 0; sample < options.samples; sample += 1) {
      const listStartedAt = performance.now();
      const sessions = await SessionManager.listAll(directory);
      listMs.push(performance.now() - listStartedAt);
      validSessions = sessions.length;

      const indexColdStartedAt = performance.now();
      const coldIndex = await reconcileSessionFiles(sessionFiles);
      indexColdMs.push(performance.now() - indexColdStartedAt);
      const indexedSessions = indexedSessionMetadata(coldIndex.entries);
      indexedValidSessions = indexedSessions.length;

      const indexWarmStartedAt = performance.now();
      await reconcileSessionFiles(sessionFiles, coldIndex.entries);
      indexWarmMs.push(performance.now() - indexWarmStartedAt);

      if (sample === 0) {
        const sdkByPath = new Map(sessions.map((session) => [session.path, session]));
        sdkIndexParity = indexedSessions.length === sessions.length && indexedSessions.every((session) => {
          const sdk = sdkByPath.get(session.path);
          return sdk
            && session.id === sdk.id
            && session.cwd === sdk.cwd
            && session.name === sdk.name
            && session.created === sdk.created.toISOString()
            && session.modified === sdk.modified.toISOString()
            && session.messageCount === sdk.messageCount
            && session.firstMessage === sdk.firstMessage
            && session.parentSessionPath === sdk.parentSessionPath;
        });
      }

      const serializeStartedAt = performance.now();
      const body = JSON.stringify(sessions.map((session) => ({
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        name: session.name,
        created: session.created,
        modified: session.modified,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        parentSessionPath: session.parentSessionPath,
      })));
      serializeMs.push(performance.now() - serializeStartedAt);
      responseBytes = Buffer.byteLength(body);
    }

    console.log(JSON.stringify({
      schemaVersion: 1,
      source: generated ? "synthetic-temp" : "explicit-read-only-directory",
      dataset,
      validSessions,
      indexedValidSessions,
      sdkIndexParity,
      samples: options.samples,
      timingsMs: {
        sessionScanAndParse: summarize(listMs),
        indexColdBuild: summarize(indexColdMs),
        indexWarmFingerprintValidation: summarize(indexWarmMs),
        sdkResultSerialization: summarize(serializeMs),
      },
      responseBytes,
      note: "SDK timing combines enumeration and JSONL parsing; index warm timing stats every candidate but reparses no unchanged JSONL.",
    }, null, 2));
  } finally {
    if (generated) await rm(directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
