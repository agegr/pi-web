import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
  DefaultResourceLoader,
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const {
  createProjectCommandBashExtension,
  createProjectCommandBashOperations,
  preferUserBashExtension,
  sanitizeProjectCommandEnvironment,
} = await createJiti(import.meta.url).import("./project-command-env.ts");

const HOST_ENVIRONMENT = {
  PORT: "30141",
  NODE_ENV: "production",
  NEXT_RUNTIME: "nodejs",
  NEXT_PRIVATE_WORKER: "1",
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/pi",
  HTTPS_PROXY: "http://proxy.example",
  OPENROUTER_API_KEY: "secret",
  PI_USER_SETTING: "preserved",
  PI_WEB_PASSWORD: "web-login-password",
};

test("sanitizes host variables using platform casing rules", () => {
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(HOST_ENVIRONMENT, "linux"),
    {
      PATH: HOST_ENVIRONMENT.PATH,
      HOME: HOST_ENVIRONMENT.HOME,
      HTTPS_PROXY: HOST_ENVIRONMENT.HTTPS_PROXY,
      OPENROUTER_API_KEY: HOST_ENVIRONMENT.OPENROUTER_API_KEY,
      PI_USER_SETTING: HOST_ENVIRONMENT.PI_USER_SETTING,
    },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        Port: "30141",
        node_env: "production",
        Next_Runtime: "nodejs",
        NEXT_PUBLIC_FLAG: "1",
        Pi_Web_Password: "web-login-password",
        Path: "C:\\Windows",
      },
      "win32",
    ),
    { Path: "C:\\Windows" },
  );
  assert.deepEqual(
    sanitizeProjectCommandEnvironment(
      {
        PORT: "30141",
        Port: "project-value",
        NODE_ENV: "production",
        node_env: "project-mode",
        NEXT_RUNTIME: "nodejs",
        Next_Runtime: "project-runtime",
      },
      "linux",
    ),
    {
      Port: "project-value",
      node_env: "project-mode",
      Next_Runtime: "project-runtime",
    },
  );
});

test("agent bash removes host variables while preserving SDK and user environment", async () => {
  const original = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PRIVATE_WORKER: process.env.NEXT_PRIVATE_WORKER,
    PI_USER_SETTING: process.env.PI_USER_SETTING,
    PI_WEB_PASSWORD: process.env.PI_WEB_PASSWORD,
  };
  Object.assign(process.env, {
    PORT: "30141",
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    NEXT_PRIVATE_WORKER: "1",
    PI_USER_SETTING: "preserved",
    PI_WEB_PASSWORD: "web-login-password",
  });

  try {
    const extension = createProjectCommandBashExtension({
      cwd: process.cwd(),
      settings: {
        getShellCommandPrefix: () => undefined,
        getShellPath: () => undefined,
      },
    });
    let registeredTool;
    await extension.factory({
      registerTool(tool) {
        registeredTool = tool;
      },
    });

    const result = await registeredTool.execute(
      "issue-484",
      {
        command: `node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,NEXT_PRIVATE_WORKER:process.env.NEXT_PRIVATE_WORKER,PI_USER_SETTING:process.env.PI_USER_SETTING,PI_WEB_PASSWORD:process.env.PI_WEB_PASSWORD,PI_SESSION_ID:process.env.PI_SESSION_ID,PATH:process.env.PATH}))'`,
      },
      undefined,
      undefined,
      {
        model: undefined,
        thinkingLevel: "off",
        sessionManager: {
          getSessionId: () => "session-484",
          getSessionFile: () => undefined,
        },
      },
    );
    const childEnvironment = JSON.parse(result.content[0].text);

    assert.equal(childEnvironment.PORT, undefined);
    assert.equal(childEnvironment.NODE_ENV, undefined);
    assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
    assert.equal(childEnvironment.NEXT_PRIVATE_WORKER, undefined);
    assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
    assert.equal(childEnvironment.PI_WEB_PASSWORD, undefined);
    assert.equal(childEnvironment.PI_SESSION_ID, "session-484");
    assert.ok(childEnvironment.PATH.split(delimiter).includes(join(getAgentDir(), "bin")));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("agent bash reads current shell settings for every execution", async () => {
  let commandPrefix = "export PI_WEB_PREFIX=first";
  const extension = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => commandPrefix,
      getShellPath: () => undefined,
    },
  });
  let registeredTool;
  await extension.factory({
    registerTool(tool) {
      registeredTool = tool;
    },
  });
  const execute = () => registeredTool.execute(
    "settings-reload",
    { command: "printf %s \"$PI_WEB_PREFIX\"" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal((await execute()).content[0].text, "first");
  commandPrefix = "export PI_WEB_PREFIX=second";
  assert.equal((await execute()).content[0].text, "second");
});

test("direct bash removes host variables and allows explicit project values", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const operations = createProjectCommandBashOperations({
    agentBinDir,
    baseEnvironment: {
      ...HOST_ENVIRONMENT,
      PATH: process.env.PATH,
      PI_SESSION_ID: "stale-host-value",
    },
    localOperations: createLocalBashOperations(),
  });
  let output = "";

  await operations.exec(
    `NODE_ENV=test PORT=3200 node -e 'console.log(JSON.stringify({PORT:process.env.PORT,NODE_ENV:process.env.NODE_ENV,NEXT_RUNTIME:process.env.NEXT_RUNTIME,PI_USER_SETTING:process.env.PI_USER_SETTING,PATH:process.env.PATH}))'`,
    process.cwd(),
    { onData: (chunk) => { output += chunk.toString(); } },
  );
  const childEnvironment = JSON.parse(output);

  assert.equal(childEnvironment.PORT, "3200");
  assert.equal(childEnvironment.NODE_ENV, "test");
  assert.equal(childEnvironment.NEXT_RUNTIME, undefined);
  assert.equal(childEnvironment.PI_USER_SETTING, "preserved");
  assert.ok(childEnvironment.PATH.split(delimiter).includes(agentBinDir));
});

test("direct bash preserves execution controls and streaming callbacks", async () => {
  const signal = new AbortController().signal;
  let received;
  let streamed = "";
  const operations = createProjectCommandBashOperations({
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      async exec(command, cwd, options) {
        received = { command, cwd, options };
        options.onData(Buffer.from("streamed"));
        return { exitCode: 0 };
      },
    },
  });

  await operations.exec("echo ready", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal,
    timeout: 12,
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.cwd, "/project");
  assert.equal(received.options.signal, signal);
  assert.equal(received.options.timeout, 12);
  assert.equal(streamed, "streamed");
});

test("Stop releases a command whose output a surviving process keeps open", async () => {
  let forward;
  let settleLocal;
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec(_command, _cwd, options) {
        forward = options.onData;
        // Pi's backend keeps waiting while an inherited pipe is still written to.
        return new Promise((_resolve, reject) => {
          settleLocal = () => reject(new Error("aborted"));
        });
      },
    },
  });
  const controller = new AbortController();
  let streamed = "";
  const execution = operations.exec("python a.py & python b.py & wait", "/project", {
    onData: (chunk) => { streamed += chunk.toString(); },
    signal: controller.signal,
  });

  forward(Buffer.from("before "));
  controller.abort();
  forward(Buffer.from("during "));
  await assert.rejects(execution, { message: "aborted" });
  forward(Buffer.from("after"));
  // The survivor finally exits; its late settlement must go nowhere.
  settleLocal();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(streamed, "before during ");
});

test("Stop keeps pi's own abort result when the process tree dies in time", async () => {
  const piAbortError = new Error("aborted");
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 5_000,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec(_command, _cwd, options) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => setTimeout(() => reject(piAbortError), 10));
        });
      },
    },
  });
  const controller = new AbortController();
  const startedAt = Date.now();
  const execution = operations.exec("python a.py", "/project", {
    onData() {},
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(execution, (error) => error === piAbortError);
  assert.ok(Date.now() - startedAt < 1_000);
});

test(
  "Stop ends the bash tool while an escaped descendant keeps writing",
  { skip: process.platform === "win32", timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-bash-abort-"));
    const pidFile = join(directory, "survivor.pid");
    t.after(async () => {
      try {
        process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");
      } catch {}
      await rm(directory, { recursive: true, force: true });
    });
    // `detached` puts the writer in its own session, out of reach of the
    // process-group kill, while it still holds the tool's stdout.
    const survivor = [
      "const { spawn } = require('node:child_process');",
      "const writer = spawn(process.execPath, ['-e', 'setInterval(() => console.log(Date.now()), 20)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(writer.pid));`,
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const tool = createBashToolDefinition(directory, {
      operations: createProjectCommandBashOperations({ abortSettleGraceMs: 200 }),
    });
    const controller = new AbortController();
    let outputSeen;
    const outputStarted = new Promise((resolve) => { outputSeen = resolve; });
    const execution = tool.execute(
      "issue-647",
      { command: `node -e ${JSON.stringify(survivor)}` },
      controller.signal,
      (update) => {
        if (update.content[0]?.text) outputSeen();
      },
      undefined,
    );

    await outputStarted;
    const abortedAt = Date.now();
    controller.abort();
    await assert.rejects(execution, /Command aborted$/);

    assert.ok(Date.now() - abortedAt < 3_000);
    // The release came from Pi Web, not from the writer going away.
    const survivorPid = Number(await readFile(pidFile, "utf8"));
    assert.doesNotThrow(() => process.kill(survivorPid, 0));
  },
);

test("a timeout releases a command whose output a surviving process keeps open", async () => {
  let settleLocal;
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec() {
        // Pi's timeout killed the tree but an inherited pipe is still written to.
        return new Promise((_resolve, reject) => {
          settleLocal = () => reject(new Error("timeout:0.01"));
        });
      },
    },
  });

  await assert.rejects(
    operations.exec("python a.py", "/project", { onData() {}, timeout: 0.01 }),
    { message: "timeout:0.01" },
  );
  settleLocal();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a command that finishes before its timeout keeps its result", async () => {
  const operations = createProjectCommandBashOperations({
    abortSettleGraceMs: 20,
    baseEnvironment: HOST_ENVIRONMENT,
    localOperations: {
      exec: async () => ({ exitCode: 0 }),
    },
  });

  assert.deepEqual(
    await operations.exec("true", "/project", { onData() {}, timeout: 0.01 }),
    { exitCode: 0 },
  );
  // Nothing may fire after the result: the timer is cleared with the release.
  await new Promise((resolve) => setTimeout(resolve, 60));
});

test(
  "a timeout ends the bash tool while an escaped descendant keeps writing",
  { skip: process.platform === "win32", timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-bash-timeout-"));
    const pidFile = join(directory, "survivor.pid");
    t.after(async () => {
      try {
        process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");
      } catch {}
      await rm(directory, { recursive: true, force: true });
    });
    const survivor = [
      "const { spawn } = require('node:child_process');",
      "const writer = spawn(process.execPath, ['-e', 'setInterval(() => console.log(Date.now()), 20)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(writer.pid));`,
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const tool = createBashToolDefinition(directory, {
      operations: createProjectCommandBashOperations({ abortSettleGraceMs: 200 }),
    });
    const startedAt = Date.now();

    await assert.rejects(
      tool.execute(
        "issue-647-timeout",
        { command: `node -e ${JSON.stringify(survivor)}`, timeout: 1 },
        undefined,
        undefined,
        undefined,
      ),
      /Command timed out after 1 seconds$/,
    );

    assert.ok(Date.now() - startedAt < 4_000);
    const survivorPid = Number(await readFile(pidFile, "utf8"));
    assert.doesNotThrow(() => process.kill(survivorPid, 0));
  },
);

async function captureOperationEnvironment(options) {
  let environment;
  const operations = createProjectCommandBashOperations({
    ...options,
    localOperations: {
      async exec(_command, _cwd, executionOptions) {
        environment = executionOptions.env;
        return { exitCode: 0 };
      },
    },
  });
  await operations.exec("echo ready", "/project", {
    onData() {},
  });
  return environment;
}

test("direct bash updates the platform PATH key", async () => {
  const agentBinDir = join(process.cwd(), ".test-agent", "bin");
  const cases = [
    {
      options: { agentBinDir, baseEnvironment: { Path: "project-metadata", PATH: "/usr/bin" }, platform: "linux" },
      expected: { Path: "project-metadata", PATH: `${agentBinDir}${delimiter}/usr/bin` },
    },
    {
      options: { agentBinDir: "C:\\pi-agent\\bin", baseEnvironment: { Path: "C:\\Windows" }, platform: "win32" },
      expected: { Path: "C:\\pi-agent\\bin;C:\\Windows" },
    },
  ];

  for (const { options, expected } of cases) {
    assert.deepEqual(await captureOperationEnvironment(options), expected);
  }
});

test("a user extension keeps priority over the Pi Web fallback bash tool", async () => {
  const userBash = {
    name: "user-bash",
    factory: (pi) => {
      pi.registerTool({
        name: "bash",
        label: "user bash",
        description: "user override",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "user override" }], details: undefined };
        },
      });
    },
  };
  const hostBash = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => undefined,
      getShellPath: () => undefined,
    },
  });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(process.cwd(), ".test-agent"),
    extensionFactories: [userBash, hostBash],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionsOverride: (base) => preferUserBashExtension(base),
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  const bashDefinitions = extensions.extensions
    .map((extension) => extension.tools.get("bash")?.definition)
    .filter(Boolean);

  assert.equal(bashDefinitions.length, 1);
  assert.equal(bashDefinitions[0].description, "user override");
  assert.deepEqual(extensions.errors, []);
});

test("a foreground command without timeout auto-backgrounds and notifies on completion", async () => {
  const notifications = [];
  const operations = createProjectCommandBashOperations({
    autoBackgroundMs: 50,
    bgTask: { sessionId: "session-bg", notify: async (_id, text) => { notifications.push(text); } },
  });
  await assert.rejects(
    operations.exec("sleep 0.3 && echo done", process.cwd(), { onData() {} }),
    /bg-task-backgrounded:/,
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /completed/);
  assert.match(notifications[0], /echo/);
});

test("an explicit timeout does not disable the auto-background handoff", async () => {
  const notifications = [];
  const operations = createProjectCommandBashOperations({
    autoBackgroundMs: 50,
    bgTask: { sessionId: "session-bg", notify: async (_id, text) => { notifications.push(text); } },
  });
  // The timeout stays the process's own limit; the handoff only releases the model.
  await assert.rejects(
    operations.exec("sleep 0.3 && echo done", process.cwd(), { onData() {}, timeout: 30 }),
    /bg-task-backgrounded:/,
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /completed/);
});

test("a timeout shorter than the handoff still wins", async () => {
  const operations = createProjectCommandBashOperations({
    autoBackgroundMs: 5000,
    bgTask: { sessionId: "session-bg", notify: async () => {} },
  });
  await assert.rejects(
    operations.exec("sleep 5", process.cwd(), { onData() {}, timeout: 0.1 }),
    /timeout:0.1/,
  );
});

test("Stop aborts a foreground command while a bg task is armed", async () => {
  const controller = new AbortController();
  const operations = createProjectCommandBashOperations({
    autoBackgroundMs: 120_000,
    bgTask: { sessionId: "session-bg", notify: async () => {} },
  });
  const startedAt = Date.now();
  const execution = operations.exec("sleep 30", process.cwd(), { onData() {}, signal: controller.signal });
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(execution, /aborted/);
  assert.ok(Date.now() - startedAt < 10_000, "must not wait out the command");
});

test("Stop leaves an already handed-off background command running", async () => {
  const notifications = [];
  const controller = new AbortController();
  const operations = createProjectCommandBashOperations({
    autoBackgroundMs: 50,
    bgTask: { sessionId: "session-bg", notify: async (_id, text) => { notifications.push(text); } },
  });
  await assert.rejects(
    operations.exec("sleep 0.4 && echo done", process.cwd(), { onData() {}, signal: controller.signal }),
    /bg-task-backgrounded:/,
  );
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /completed/);
});

test("run_in_background returns immediately and notifies on completion", async () => {
  const notifications = [];
  const extension = createProjectCommandBashExtension({
    cwd: process.cwd(),
    settings: {
      getShellCommandPrefix: () => undefined,
      getShellPath: () => undefined,
    },
    bgTasks: { notify: async (_id, text) => { notifications.push(text); } },
  });
  let registeredTool;
  await extension.factory({ registerTool(tool) { registeredTool = tool; } });
  const result = await registeredTool.execute(
    "bg-1",
    { command: "echo bg-done", run_in_background: true },
    undefined,
    undefined,
    {
      model: undefined,
      thinkingLevel: "off",
      sessionManager: { getSessionId: () => "session-bg", getSessionFile: () => undefined },
    },
  );
  assert.match(result.content[0].text, /started in background/);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /completed/);
  assert.match(notifications[0], /bg-done/);
});
