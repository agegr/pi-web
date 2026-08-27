import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type Tool,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import {
  create,
  fromBinary,
  fromJson,
  type JsonValue,
  toBinary,
  toJson,
} from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { inferContextWindow, resolveCursorWireModelId, type CursorModel } from "./models";
import {
  AgentClientMessageSchema,
  AgentConversationTurnStructureSchema,
  AgentRunRequestSchema,
  AgentServerMessageSchema,
  AssistantMessageSchema,
  BackgroundShellSpawnResultSchema,
  CancelActionSchema,
  ClientHeartbeatSchema,
  ConversationActionSchema,
  ConversationStateStructureSchema,
  ConversationStepSchema,
  ConversationTurnStructureSchema,
  DeleteRejectedSchema,
  DeleteResultSchema,
  DiagnosticsResultSchema,
  ExecClientMessageSchema,
  FetchErrorSchema,
  FetchResultSchema,
  GetBlobResultSchema,
  GetUsableModelsRequestSchema,
  GetUsableModelsResponseSchema,
  GrepErrorSchema,
  GrepResultSchema,
  KvClientMessageSchema,
  LsRejectedSchema,
  LsResultSchema,
  McpArgsSchema,
  McpErrorSchema,
  McpResultSchema,
  McpSuccessSchema,
  McpTextContentSchema,
  McpToolCallSchema,
  McpToolDefinitionSchema,
  McpToolErrorSchema,
  McpToolResultContentItemSchema,
  McpToolResultSchema,
  ModelDetailsSchema,
  ReadRejectedSchema,
  ReadResultSchema,
  RequestContextResultSchema,
  RequestContextSchema,
  RequestContextSuccessSchema,
  ResumeActionSchema,
  SelectedContextSchema,
  SelectedImageSchema,
  SetBlobResultSchema,
  ShellRejectedSchema,
  ShellResultSchema,
  ShellStreamSchema,
  ToolCallSchema,
  UserMessageActionSchema,
  UserMessageSchema,
  WriteRejectedSchema,
  WriteResultSchema,
  WriteShellStdinErrorSchema,
  WriteShellStdinResultSchema,
  type AgentClientMessage,
  type AgentServerMessage,
  type ConversationStateStructure,
  type ExecServerMessage,
  type KvServerMessage,
  type McpToolDefinition,
  type UserMessage,
} from "./proto/agent_pb";
import {
  callCursorUnary,
  openCursorBridge,
  type CursorBridge,
} from "./transport";

const CONNECT_END_STREAM_FLAG = 0b0000_0010;
const MODEL_CACHE_TTL_MS = 30 * 60_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const STREAM_STALL_TIMEOUT_MS = 120_000;

interface ParsedImage {
  mimeType: string;
  data: Uint8Array;
}

interface ParsedAssistantTextStep {
  kind: "assistantText";
  text: string;
}

interface ParsedToolCallStep {
  kind: "toolCall";
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: { content: string; isError: boolean };
}

type ParsedTurnStep = ParsedAssistantTextStep | ParsedToolCallStep;

export interface ParsedTurn {
  userText: string;
  images: ParsedImage[];
  steps: ParsedTurnStep[];
}

interface ParsedContext {
  systemPrompt: string;
  userText: string;
  userImages: ParsedImage[];
  turns: ParsedTurn[];
  toolResults: Array<{ toolCallId: string; content: string; isError: boolean }>;
  openTurn: ParsedTurn | null;
  tools: Tool[] | undefined;
}

interface PendingExec {
  execId: string;
  execMsgId: number;
  toolCallId: string;
  toolName: string;
  decodedArgs: Record<string, unknown>;
}

interface StreamState {
  outputTokens: number;
  totalTokens: number;
  cursorContextWindow: number;
  inferredContextWindow: number;
}

export interface StoredConversation {
  conversationId: string;
  checkpoint: Uint8Array | null;
  blobStore: Map<string, Uint8Array>;
  historyFingerprint?: string;
  effectiveContextWindow?: number;
  lastTotalTokens?: number;
}

interface LiveBridge {
  bridge: CursorBridge;
  key: string;
  ephemeral: boolean;
  blobStore: Map<string, Uint8Array>;
  mcpTools: McpToolDefinition[];
  pendingExecs: PendingExec[];
  currentTurn: ParsedTurn;
  completedTurns: ParsedTurn[];
  state: StreamState;
  preTurnCheckpoint: Uint8Array | null;
  latestCheckpoint: Uint8Array | null;
  heartbeatTimer: ReturnType<typeof setInterval>;
  waitingForTools: boolean;
  response: { status: number; headers: Record<string, string> };
  onActivity?: () => void;
  onText?: (text: string, thinking: boolean) => void;
  onExec?: (exec: PendingExec) => void;
  onEnd?: (data: Uint8Array) => void;
  onClose?: (error: Error) => void;
}

interface CursorRuntime {
  liveBridges: Map<string, LiveBridge>;
  conversations: Map<string, StoredConversation>;
}

declare global {
  var __piCursorRuntime: CursorRuntime | undefined;
}

function getRuntime(): CursorRuntime {
  if (!globalThis.__piCursorRuntime) {
    globalThis.__piCursorRuntime = {
      liveBridges: new Map(),
      conversations: new Map(),
    };
  }
  return globalThis.__piCursorRuntime;
}

const liveBridges = getRuntime().liveBridges;
const conversations = getRuntime().conversations;
type BridgeFactory = typeof openCursorBridge;
let bridgeFactory: BridgeFactory = openCursorBridge;

export const __testInternals = { liveBridges, conversations };

export function setCursorBridgeFactoryForTests(factory?: BridgeFactory): void {
  bridgeFactory = factory ?? openCursorBridge;
}

function frameConnectMessage(data: Uint8Array, flags = 0): Uint8Array {
  const frame = Buffer.alloc(5 + data.length);
  frame[0] = flags;
  frame.writeUInt32BE(data.length, 1);
  frame.set(data, 5);
  return frame;
}

function createConnectFrameParser(
  onMessage: (bytes: Uint8Array) => void,
  onEndStream: (bytes: Uint8Array) => void,
): (incoming: Buffer) => void {
  let pending = Buffer.alloc(0);
  return (incoming) => {
    pending = Buffer.concat([pending, incoming]);
    while (pending.length >= 5) {
      const flags = pending[0]!;
      const length = pending.readUInt32BE(1);
      if (pending.length < 5 + length) return;
      const data = pending.subarray(5, 5 + length);
      pending = pending.subarray(5 + length);
      if (flags & CONNECT_END_STREAM_FLAG) onEndStream(data);
      else onMessage(data);
    }
  };
}

function modelCachePath(): string {
  return join(getAgentDir(), "cursor-models-cache.json");
}

let cachedModels: CursorModel[] | null = null;
let cachedModelsAt = 0;
let cachedModelsAccount = "";
let modelDiscovery: Promise<CursorModel[]> | undefined;
let modelDiscoveryAccount = "";

export function accountCacheKey(apiKey: string): string {
  try {
    const payload = apiKey.split(".")[1];
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        sub?: unknown;
        email?: unknown;
      };
      if (typeof decoded.sub === "string" && decoded.sub) return `sub:${decoded.sub}`;
      if (typeof decoded.email === "string" && decoded.email) return `email:${decoded.email}`;
    }
  } catch {
    // 非 JWT 凭据使用令牌摘要隔离缓存。
  }
  return `tok:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

interface CursorModelCacheFile {
  models: CursorModel[];
  accountKey?: string;
  savedAt?: number;
}

function readModelCache(): CursorModelCacheFile | null {
  try {
    const parsed = JSON.parse(readFileSync(modelCachePath(), "utf8")) as CursorModelCacheFile;
    return parsed.models?.length ? parsed : null;
  } catch {
    return null;
  }
}

export function loadCachedModels(accountKey?: string): CursorModel[] | null {
  const cached = readModelCache();
  if (!cached) return null;
  if (accountKey ? cached.accountKey !== accountKey : Boolean(cached.accountKey)) return null;
  return cached.models;
}

export function cursorModelCacheIsFresh(apiKey: string): boolean {
  const accountKey = accountCacheKey(apiKey);
  if (
    cachedModels?.length
    && cachedModelsAccount === accountKey
    && Date.now() - cachedModelsAt < MODEL_CACHE_TTL_MS
  ) {
    return true;
  }
  const cached = readModelCache();
  return Boolean(
    cached
    && cached.accountKey === accountKey
    && typeof cached.savedAt === "number"
    && Date.now() - cached.savedAt < MODEL_CACHE_TTL_MS,
  );
}

function saveCachedModels(models: CursorModel[], accountKey: string): void {
  try {
    const directory = getAgentDir();
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    writeFileSync(
      modelCachePath(),
      JSON.stringify({ accountKey, savedAt: Date.now(), models }, null, 2),
      "utf8",
    );
  } catch {
    // 缓存写入失败不能影响模型发现。
  }
}

function decodeConnectUnaryBody(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 5) return null;
  let offset = 0;
  while (offset + 5 <= payload.length) {
    const flags = payload[offset]!;
    const length = new DataView(
      payload.buffer,
      payload.byteOffset + offset,
      payload.byteLength - offset,
    ).getUint32(1, false);
    const end = offset + 5 + length;
    if (end > payload.length) return null;
    if ((flags & 0b0000_0001) !== 0) return null;
    if ((flags & CONNECT_END_STREAM_FLAG) === 0) {
      return payload.subarray(offset + 5, end);
    }
    offset = end;
  }
  return null;
}

function normalizeCursorModels(models: readonly unknown[]): CursorModel[] {
  const byId = new Map<string, CursorModel>();
  for (const model of models) {
    if (!model || typeof model !== "object") continue;
    const value = model as Record<string, unknown>;
    const id = typeof value.modelId === "string" ? value.modelId.trim() : "";
    if (!id) continue;
    byId.set(id, {
      id,
      name: String(value.displayName || value.displayNameShort || value.displayModelId || id),
      reasoning: Boolean(value.thinkingDetails),
      contextWindow: inferContextWindow(id),
      maxTokens: 64_000,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getCursorModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<CursorModel[]> {
  const accountKey = accountCacheKey(apiKey);
  if (
    cachedModels
    && cachedModelsAccount === accountKey
    && Date.now() - cachedModelsAt < MODEL_CACHE_TTL_MS
  ) {
    return cachedModels;
  }
  if (modelDiscovery && modelDiscoveryAccount === accountKey) {
    return modelDiscovery;
  }

  modelDiscoveryAccount = accountKey;
  modelDiscovery = (async () => {
    const request = create(GetUsableModelsRequestSchema, {});
    const raw = await callCursorUnary({
      accessToken: apiKey,
      rpcPath: "/agent.v1.AgentService/GetUsableModels",
      requestBody: toBinary(GetUsableModelsRequestSchema, request),
      signal,
      timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS,
    });
    let response;
    try {
      response = fromBinary(GetUsableModelsResponseSchema, raw);
    } catch {
      const body = decodeConnectUnaryBody(raw);
      if (!body) throw new Error("Cursor returned an invalid model catalog");
      response = fromBinary(GetUsableModelsResponseSchema, body);
    }
    const models = normalizeCursorModels(response.models);
    if (models.length === 0) throw new Error("Cursor returned an empty model catalog");
    cachedModels = models;
    cachedModelsAt = Date.now();
    cachedModelsAccount = accountKey;
    saveCachedModels(models, accountKey);
    return models;
  })();
  try {
    return await modelDiscovery;
  } finally {
    if (modelDiscoveryAccount === accountKey) modelDiscovery = undefined;
  }
}

function contentText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function contentImages(content: string | Array<{ type: string; data?: string; mimeType?: string }>): ParsedImage[] {
  if (typeof content === "string") return [];
  return content.flatMap((part) =>
    part.type === "image" && part.data && part.mimeType
      ? [{ mimeType: part.mimeType, data: Buffer.from(part.data, "base64") }]
      : [],
  );
}

function toolResultText(content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>): string {
  return content
    .map((part) => part.type === "text" ? part.text ?? "" : `[image:${part.mimeType ?? "unknown"}]`)
    .join("\n");
}

function appendAssistantText(turn: ParsedTurn, text: string): void {
  if (!text) return;
  const previous = turn.steps.at(-1);
  if (previous?.kind === "assistantText") previous.text += text;
  else turn.steps.push({ kind: "assistantText", text });
}

export function parseContext(context: Context): ParsedContext {
  const turns: ParsedTurn[] = [];
  let current:
    | (ParsedTurn & { toolCalls: Map<string, ParsedToolCallStep> })
    | null = null;

  const finishCurrent = () => {
    if (!current) return;
    turns.push({ userText: current.userText, images: current.images, steps: current.steps });
    current = null;
  };

  for (const message of context.messages) {
    if (message.role === "user") {
      finishCurrent();
      current = {
        userText: contentText(message.content),
        images: contentImages(message.content),
        steps: [],
        toolCalls: new Map(),
      };
      continue;
    }
    if (!current) continue;

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") {
          appendAssistantText(current, block.text);
        } else if (block.type === "toolCall") {
          const step: ParsedToolCallStep = {
            kind: "toolCall",
            toolCallId: block.id,
            toolName: block.name,
            arguments: block.arguments,
          };
          current.steps.push(step);
          current.toolCalls.set(step.toolCallId, step);
        }
      }
      continue;
    }

    const result = {
      content: toolResultText(message.content),
      isError: message.isError,
    };
    const existing = current.toolCalls.get(message.toolCallId);
    if (existing) {
      existing.result = result;
    } else {
      const step: ParsedToolCallStep = {
        kind: "toolCall",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        arguments: {},
        result,
      };
      current.steps.push(step);
      current.toolCalls.set(step.toolCallId, step);
    }
  }

  let userText = "";
  let userImages: ParsedImage[] = [];
  let toolResults: ParsedContext["toolResults"] = [];
  let openTurn: ParsedTurn | null = null;
  if (current) {
    const toolCalls = current.steps.filter(
      (step): step is ParsedToolCallStep => step.kind === "toolCall",
    );
    const last = current.steps.at(-1);
    if (current.steps.length === 0 || last?.kind === "toolCall") {
      userText = current.userText;
      userImages = current.images;
      openTurn = { userText: current.userText, images: current.images, steps: current.steps };
      toolResults = toolCalls.flatMap((step) =>
        step.result
          ? [{ toolCallId: step.toolCallId, ...step.result }]
          : [],
      );
    } else {
      finishCurrent();
    }
  }

  return {
    systemPrompt: context.systemPrompt ?? "",
    userText,
    userImages,
    turns,
    toolResults,
    openTurn,
    tools: context.tools,
  };
}

function buildMcpTools(tools: Tool[] | undefined): McpToolDefinition[] {
  return (tools ?? []).map((tool) =>
    create(McpToolDefinitionSchema, {
      name: tool.name,
      description: tool.description,
      providerIdentifier: "pi",
      toolName: tool.name,
      inputSchema: toBinary(
        ValueSchema,
        fromJson(ValueSchema, tool.parameters as JsonValue),
      ),
    }),
  );
}

function encodeMcpValue(value: unknown): Uint8Array {
  try {
    return toBinary(ValueSchema, fromJson(ValueSchema, value as JsonValue));
  } catch {
    return new TextEncoder().encode(String(value));
  }
}

function encodeMcpArgs(args: Record<string, unknown>): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, encodeMcpValue(value)]),
  );
}

function decodeMcpArgs(args: Record<string, Uint8Array>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      try {
        return [key, toJson(ValueSchema, fromBinary(ValueSchema, value))];
      } catch {
        return [key, new TextDecoder().decode(value)];
      }
    }),
  );
}

function buildSelectedContextBlob(
  promptBlobIds: Uint8Array[],
  clientName: string,
): Uint8Array {
  const parts: Uint8Array[] = promptBlobIds.map(
    (blobId) => new Uint8Array([0x0a, blobId.length, ...blobId]),
  );
  const client = new TextEncoder().encode(clientName);
  parts.push(new Uint8Array([0xb2, 0x01, client.length, ...client]));
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function storeBlob(data: Uint8Array, blobs: Map<string, Uint8Array>): Uint8Array {
  const id = new Uint8Array(createHash("sha256").update(data).digest());
  blobs.set(Buffer.from(id).toString("hex"), data);
  return id;
}

function selectedImages(images: ParsedImage[]) {
  return images.map((image) =>
    create(SelectedImageSchema, {
      uuid: crypto.randomUUID(),
      path: "",
      mimeType: image.mimeType,
      dataOrBlobId: { case: "data", value: image.data },
    }),
  );
}

function createUserMessage(
  text: string,
  selectedContextBlob: Uint8Array,
  images: ParsedImage[],
): UserMessage {
  const messageId = crypto.randomUUID();
  return create(UserMessageSchema, {
    text,
    messageId,
    selectedContext: create(SelectedContextSchema, {
      selectedImages: selectedImages(images),
    }),
    mode: 1,
    selectedContextBlob,
    correlationId: messageId,
  });
}

function buildTurnStep(step: ParsedTurnStep): Uint8Array {
  if (step.kind === "assistantText") {
    return toBinary(
      ConversationStepSchema,
      create(ConversationStepSchema, {
        message: {
          case: "assistantMessage",
          value: create(AssistantMessageSchema, { text: step.text }),
        },
      }),
    );
  }

  const toolName = step.toolName || "tool";
  const result = step.result
    ? create(McpToolResultSchema, {
      result: step.result.isError
        ? {
          case: "error",
          value: create(McpToolErrorSchema, { error: step.result.content }),
        }
        : {
          case: "success",
          value: create(McpSuccessSchema, {
            content: [create(McpToolResultContentItemSchema, {
              content: {
                case: "text",
                value: create(McpTextContentSchema, { text: step.result.content }),
              },
            })],
            isError: false,
          }),
        },
    })
    : undefined;
  const toolCall = create(McpToolCallSchema, {
    args: create(McpArgsSchema, {
      name: toolName,
      args: encodeMcpArgs(step.arguments),
      toolCallId: step.toolCallId,
      providerIdentifier: "pi",
      toolName,
    }),
    ...(result ? { result } : {}),
  });
  return toBinary(
    ConversationStepSchema,
    create(ConversationStepSchema, {
      message: {
        case: "toolCall",
        value: create(ToolCallSchema, {
          tool: { case: "mcpToolCall", value: toolCall },
        }),
      },
    }),
  );
}

function storeTurn(
  turn: ParsedTurn,
  selectedContextBlob: Uint8Array,
  blobs: Map<string, Uint8Array>,
): Uint8Array {
  const userMessage = createUserMessage(
    turn.userText,
    selectedContextBlob,
    turn.images,
  );
  const userMessageId = storeBlob(toBinary(UserMessageSchema, userMessage), blobs);
  const stepIds = turn.steps.map((step) => storeBlob(buildTurnStep(step), blobs));
  const agentTurn = create(AgentConversationTurnStructureSchema, {
    userMessage: userMessageId,
    steps: stepIds,
    requestId: crypto.randomUUID(),
  });
  return storeBlob(
    toBinary(
      ConversationTurnStructureSchema,
      create(ConversationTurnStructureSchema, {
        turn: { case: "agentConversationTurn", value: agentTurn },
      }),
    ),
    blobs,
  );
}

function buildRunRequest(options: {
  modelId: string;
  systemPrompt: string;
  userText: string;
  userImages: ParsedImage[];
  turns: ParsedTurn[];
  conversationId: string;
  checkpoint: Uint8Array | null;
  blobs: Map<string, Uint8Array>;
  resume: boolean;
}): { message: AgentClientMessage; blobs: Map<string, Uint8Array> } {
  const blobs = new Map(options.blobs);
  const systemBlobId = storeBlob(
    new TextEncoder().encode(JSON.stringify({ role: "system", content: options.systemPrompt })),
    blobs,
  );
  const selectedContextBlob = storeBlob(
    buildSelectedContextBlob([systemBlobId], "pi"),
    blobs,
  );
  const conversationState = options.checkpoint
    ? fromBinary(ConversationStateStructureSchema, options.checkpoint)
    : create(ConversationStateStructureSchema, {
      rootPromptMessagesJson: [systemBlobId],
      turns: options.turns.map((turn) => storeTurn(turn, selectedContextBlob, blobs)),
      todos: [],
      pendingToolCalls: [],
      previousWorkspaceUris: [],
      mode: 1,
      fileStates: {},
      fileStatesV2: {},
      summaryArchives: [],
      turnTimings: [],
      subagentStates: {},
      selfSummaryCount: 0,
      readPaths: [],
      clientName: "pi",
    });
  const userMessage = createUserMessage(
    options.userText,
    selectedContextBlob,
    options.userImages,
  );
  const action = create(ConversationActionSchema, {
    action: options.resume
      ? { case: "resumeAction", value: create(ResumeActionSchema, {}) }
      : {
        case: "userMessageAction",
        value: create(UserMessageActionSchema, { userMessage }),
      },
  });
  const runRequest = create(AgentRunRequestSchema, {
    conversationState,
    action,
    modelDetails: create(ModelDetailsSchema, {
      modelId: options.modelId,
      displayModelId: options.modelId,
      displayName: options.modelId,
    }),
    conversationId: options.conversationId,
  });
  return {
    message: create(AgentClientMessageSchema, {
      message: { case: "runRequest", value: runRequest },
    }),
    blobs,
  };
}

function sendClientMessage(bridge: CursorBridge, message: AgentClientMessage): void {
  bridge.write(frameConnectMessage(toBinary(AgentClientMessageSchema, message)));
}

function sendKvResponse(
  bridge: CursorBridge,
  serverMessage: KvServerMessage,
  messageCase: string,
  value: unknown,
): void {
  const kvMessage = create(KvClientMessageSchema, {
    id: serverMessage.id,
    message: { case: messageCase as never, value: value as never },
  });
  sendClientMessage(
    bridge,
    create(AgentClientMessageSchema, {
      message: { case: "kvClientMessage", value: kvMessage },
    }),
  );
}

function handleKvMessage(
  bridge: CursorBridge,
  message: KvServerMessage,
  blobs: Map<string, Uint8Array>,
): void {
  if (message.message.case === "getBlobArgs") {
    const key = Buffer.from(message.message.value.blobId).toString("hex");
    const blobData = blobs.get(key);
    sendKvResponse(
      bridge,
      message,
      "getBlobResult",
      create(GetBlobResultSchema, blobData ? { blobData } : {}),
    );
  } else if (message.message.case === "setBlobArgs") {
    const { blobId, blobData } = message.message.value;
    blobs.set(Buffer.from(blobId).toString("hex"), blobData);
    sendKvResponse(
      bridge,
      message,
      "setBlobResult",
      create(SetBlobResultSchema, {}),
    );
  }
}

function sendExecResponse(
  bridge: CursorBridge,
  serverMessage: ExecServerMessage,
  messageCase: string,
  value: unknown,
): void {
  const execMessage = create(ExecClientMessageSchema, {
    id: serverMessage.id,
    execId: serverMessage.execId,
    message: { case: messageCase as never, value: value as never },
  });
  sendClientMessage(
    bridge,
    create(AgentClientMessageSchema, {
      message: { case: "execClientMessage", value: execMessage },
    }),
  );
}

function handleExecMessage(
  bridge: CursorBridge,
  message: ExecServerMessage,
  tools: McpToolDefinition[],
  onMcpExec: (exec: PendingExec) => void,
): void {
  const messageCase = message.message.case;
  const rejection = "Tool not available in this environment. Use the MCP tools provided instead.";

  if (messageCase === "requestContextArgs") {
    const requestContext = create(RequestContextSchema, {
      rules: [],
      repositoryInfo: [],
      tools,
      gitRepos: [],
      projectLayouts: [],
      mcpInstructions: [],
      fileContents: {},
      customSubagents: [],
    });
    sendExecResponse(
      bridge,
      message,
      "requestContextResult",
      create(RequestContextResultSchema, {
        result: {
          case: "success",
          value: create(RequestContextSuccessSchema, { requestContext }),
        },
      }),
    );
    return;
  }

  if (messageCase === "mcpArgs") {
    const args = message.message.value;
    onMcpExec({
      execId: message.execId,
      execMsgId: message.id,
      toolCallId: args.toolCallId || crypto.randomUUID(),
      toolName: args.toolName || args.name,
      decodedArgs: decodeMcpArgs(args.args),
    });
    return;
  }

  if (messageCase === "readArgs") {
    sendExecResponse(
      bridge,
      message,
      "readResult",
      create(ReadResultSchema, {
        result: {
          case: "rejected",
          value: create(ReadRejectedSchema, {
            path: message.message.value.path,
            reason: rejection,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "lsArgs") {
    sendExecResponse(
      bridge,
      message,
      "lsResult",
      create(LsResultSchema, {
        result: {
          case: "rejected",
          value: create(LsRejectedSchema, {
            path: message.message.value.path,
            reason: rejection,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "grepArgs") {
    sendExecResponse(
      bridge,
      message,
      "grepResult",
      create(GrepResultSchema, {
        result: {
          case: "error",
          value: create(GrepErrorSchema, { error: rejection }),
        },
      }),
    );
    return;
  }
  if (messageCase === "writeArgs") {
    sendExecResponse(
      bridge,
      message,
      "writeResult",
      create(WriteResultSchema, {
        result: {
          case: "rejected",
          value: create(WriteRejectedSchema, {
            path: message.message.value.path,
            reason: rejection,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "deleteArgs") {
    sendExecResponse(
      bridge,
      message,
      "deleteResult",
      create(DeleteResultSchema, {
        result: {
          case: "rejected",
          value: create(DeleteRejectedSchema, {
            path: message.message.value.path,
            reason: rejection,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "shellArgs") {
    const args = message.message.value;
    sendExecResponse(
      bridge,
      message,
      "shellResult",
      create(ShellResultSchema, {
        result: {
          case: "rejected",
          value: create(ShellRejectedSchema, {
            command: args.command,
            workingDirectory: args.workingDirectory,
            reason: rejection,
            isReadonly: false,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "shellStreamArgs") {
    const args = message.message.value;
    sendExecResponse(
      bridge,
      message,
      "shellStream",
      create(ShellStreamSchema, {
        event: {
          case: "rejected",
          value: create(ShellRejectedSchema, {
            command: args.command,
            workingDirectory: args.workingDirectory,
            reason: rejection,
            isReadonly: false,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "backgroundShellSpawnArgs") {
    const args = message.message.value;
    sendExecResponse(
      bridge,
      message,
      "backgroundShellSpawnResult",
      create(BackgroundShellSpawnResultSchema, {
        result: {
          case: "rejected",
          value: create(ShellRejectedSchema, {
            command: args.command,
            workingDirectory: args.workingDirectory,
            reason: rejection,
            isReadonly: false,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "writeShellStdinArgs") {
    sendExecResponse(
      bridge,
      message,
      "writeShellStdinResult",
      create(WriteShellStdinResultSchema, {
        result: {
          case: "error",
          value: create(WriteShellStdinErrorSchema, { error: rejection }),
        },
      }),
    );
    return;
  }
  if (messageCase === "fetchArgs") {
    sendExecResponse(
      bridge,
      message,
      "fetchResult",
      create(FetchResultSchema, {
        result: {
          case: "error",
          value: create(FetchErrorSchema, {
            url: message.message.value.url,
            error: rejection,
          }),
        },
      }),
    );
    return;
  }
  if (messageCase === "diagnosticsArgs") {
    sendExecResponse(
      bridge,
      message,
      "diagnosticsResult",
      create(DiagnosticsResultSchema, {}),
    );
    return;
  }

  throw new Error(`Unsupported Cursor exec request: ${messageCase}`);
}

function processServerMessage(
  live: LiveBridge,
  message: AgentServerMessage,
  onText: (text: string, thinking: boolean) => void,
  onMcpExec: (exec: PendingExec) => void,
): void {
  if (message.message.case === "interactionUpdate") {
    const update = message.message.value.message;
    if (update.case === "textDelta") onText(update.value.text, false);
    else if (update.case === "thinkingDelta") onText(update.value.text, true);
    else if (update.case === "tokenDelta") {
      live.state.outputTokens += update.value.tokens;
    }
    return;
  }
  if (message.message.case === "kvServerMessage") {
    handleKvMessage(live.bridge, message.message.value, live.blobStore);
    return;
  }
  if (message.message.case === "execServerMessage") {
    handleExecMessage(
      live.bridge,
      message.message.value,
      live.mcpTools,
      onMcpExec,
    );
    return;
  }
  if (message.message.case === "conversationCheckpointUpdate") {
    const checkpoint = message.message.value as ConversationStateStructure & {
      tokenDetails?: { usedTokens?: number; maxTokens?: number };
    };
    if (checkpoint.tokenDetails?.usedTokens) {
      live.state.totalTokens = checkpoint.tokenDetails.usedTokens;
    }
    if (checkpoint.tokenDetails?.maxTokens) {
      live.state.cursorContextWindow = checkpoint.tokenDetails.maxTokens;
    }
    live.latestCheckpoint = toBinary(ConversationStateStructureSchema, checkpoint);
  }
}

function sessionKey(sessionId: string | undefined): { key: string; ephemeral: boolean } {
  if (!sessionId) return { key: crypto.randomUUID(), ephemeral: true };
  return {
    key: createHash("sha256").update(`cursor:${sessionId}`).digest("hex").slice(0, 16),
    ephemeral: false,
  };
}

export function turnsFingerprint(turns: ParsedTurn[]): string {
  const stable = turns.map((turn) => ({
    userText: turn.userText,
    images: turn.images.map((image) =>
      createHash("sha256").update(image.data).digest("hex").slice(0, 12)),
    steps: turn.steps,
  }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function checkpointMatches(stored: StoredConversation, turns: ParsedTurn[]): boolean {
  if (!stored.checkpoint) return false;
  return !stored.historyFingerprint || stored.historyFingerprint === turnsFingerprint(turns);
}

function resetConversation(stored: StoredConversation): void {
  stored.conversationId = crypto.randomUUID();
  stored.checkpoint = null;
  stored.blobStore = new Map();
  stored.historyFingerprint = undefined;
  stored.effectiveContextWindow = undefined;
  stored.lastTotalTokens = undefined;
}

function deterministicConversationId(key: string): string {
  const hex = createHash("sha256")
    .update(`cursor-conversation:${key}`)
    .digest("hex")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${(0x8 | (Number.parseInt(hex[16]!, 16) & 0x3)).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20),
  ].join("-");
}

function getConversation(key: string): StoredConversation {
  let stored = conversations.get(key);
  if (!stored) {
    stored = {
      conversationId: deterministicConversationId(key),
      checkpoint: null,
      blobStore: new Map(),
    };
    conversations.set(key, stored);
  }
  return stored;
}

function makeHeartbeat(): Uint8Array {
  const message = create(AgentClientMessageSchema, {
    message: {
      case: "clientHeartbeat",
      value: create(ClientHeartbeatSchema, {}),
    },
  });
  return frameConnectMessage(toBinary(AgentClientMessageSchema, message));
}

function sendCancel(bridge: CursorBridge): void {
  const action = create(ConversationActionSchema, {
    action: { case: "cancelAction", value: create(CancelActionSchema, {}) },
  });
  sendClientMessage(
    bridge,
    create(AgentClientMessageSchema, {
      message: { case: "conversationAction", value: action },
    }),
  );
}

function detachBridge(live: LiveBridge): void {
  if (liveBridges.get(live.key) === live) liveBridges.delete(live.key);
  clearInterval(live.heartbeatTimer);
}

function closeBridge(
  live: LiveBridge,
  error = new Error("Cursor request cancelled"),
): void {
  const notify = live.onClose;
  live.onClose = undefined;
  detachBridge(live);
  if (live.bridge.alive) {
    sendCancel(live.bridge);
    live.bridge.destroy(error);
  }
  notify?.(error);
}

export function cleanupSessionState(sessionId?: string): void {
  if (!sessionId) return;
  const { key } = sessionKey(sessionId);
  const live = liveBridges.get(key);
  if (live) closeBridge(live);
  conversations.delete(key);
}

function contextOverflow(message: string): boolean {
  return /context[_ ]?(length|window)|context.{0,24}(exceed|full)|length[_ ]exceed|too.?long|too.?large|prompt.?too.?large|overflow/i.test(message);
}

export function mapConnectErrorCode(code: string, message: string): string {
  if (code === "unauthenticated") {
    return "Cursor authentication expired — sign in again from Models → Subscriptions";
  }
  if (code === "resource_exhausted") {
    return contextOverflow(message)
      ? "context_length_exceeded: Cursor rejected the request as too large"
      : "Cursor quota or rate limit reached — try again shortly";
  }
  if (code === "invalid_argument" && contextOverflow(message)) {
    return "context_length_exceeded: Cursor rejected the request as too large";
  }
  if (code === "deadline_exceeded") return "Cursor request timed out server-side — try again";
  if (code === "unavailable") return "Cursor service unavailable — try again";
  if (code === "internal") return "Cursor internal error — try again";
  return message;
}

function parseEndStream(data: Uint8Array): string | null {
  if (data.length === 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(data)) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "Cursor returned an invalid Connect end-stream envelope";
    }
    const error = (payload as { error?: unknown }).error;
    if (error === undefined) return null;
    if (!error || typeof error !== "object" || Array.isArray(error)) {
      return "Cursor returned an invalid Connect end-stream envelope";
    }
    const fields = error as { code?: unknown; message?: unknown };
    return mapConnectErrorCode(
      String(fields.code ?? "unknown"),
      String(fields.message ?? "Unknown Cursor error"),
    );
  } catch {
    return "Cursor returned a malformed Connect end-stream envelope";
  }
}

const THINKING_TAG = /<(\/?)(?:think|thinking|reasoning|thought|think_intent)\s*>/gi;

function createThinkingFilter() {
  let buffer = "";
  let thinking = false;
  return {
    process(text: string): { text: string; thinking: string } {
      const input = buffer + text;
      buffer = "";
      let visible = "";
      let reasoning = "";
      let offset = 0;
      THINKING_TAG.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = THINKING_TAG.exec(input))) {
        const before = input.slice(offset, match.index);
        if (thinking) reasoning += before;
        else visible += before;
        thinking = match[1] !== "/";
        offset = THINKING_TAG.lastIndex;
      }
      const rest = input.slice(offset);
      const tagStart = rest.lastIndexOf("<");
      if (tagStart >= 0 && rest.length - tagStart < 16 && /^<\/?[a-z_]*$/i.test(rest.slice(tagStart))) {
        const before = rest.slice(0, tagStart);
        if (thinking) reasoning += before;
        else visible += before;
        buffer = rest.slice(tagStart);
      } else if (thinking) {
        reasoning += rest;
      } else {
        visible += rest;
      }
      return { text: visible, thinking: reasoning };
    },
    flush(): { text: string; thinking: string } {
      const rest = buffer;
      buffer = "";
      return thinking
        ? { text: "", thinking: rest }
        : { text: rest, thinking: "" };
    },
  };
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createOutput(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function updateUsage(live: LiveBridge, model: Model<Api>, output: AssistantMessage): void {
  const completion = live.state.outputTokens;
  let total = live.state.totalTokens || completion;
  if (
    live.state.cursorContextWindow > 0
    && live.state.inferredContextWindow > live.state.cursorContextWindow
  ) {
    total = Math.round(
      total * live.state.inferredContextWindow / live.state.cursorContextWindow,
    );
  }
  output.usage.input = Math.max(0, total - completion);
  output.usage.output = completion;
  output.usage.totalTokens = total;
  calculateCost(model, output.usage);
}

function restoreCheckpoint(live: LiveBridge): void {
  const stored = conversations.get(live.key);
  if (!stored) return;
  stored.checkpoint = live.preTurnCheckpoint
    ? new Uint8Array(live.preTurnCheckpoint)
    : null;
}

function persistConversation(live: LiveBridge): void {
  const stored = conversations.get(live.key);
  if (!stored) return;
  for (const [key, value] of live.blobStore) stored.blobStore.set(key, value);
  if (live.latestCheckpoint) stored.checkpoint = live.latestCheckpoint;
  if (live.state.cursorContextWindow > 0) {
    stored.effectiveContextWindow = live.state.cursorContextWindow;
  }
  if (live.state.totalTokens > 0) stored.lastTotalTokens = live.state.totalTokens;
  stored.historyFingerprint = turnsFingerprint([
    ...live.completedTurns,
    live.currentTurn,
  ]);
}

function classifyTransportError(
  result: { error?: Error; status?: number },
): Error {
  if (result.error) return result.error;
  if (result.status === 401 || result.status === 403) {
    return new Error("Cursor authentication expired — sign in again from Models → Subscriptions");
  }
  if (result.status === 429) {
    return new Error("Cursor quota or rate limit reached — try again shortly");
  }
  if (result.status && result.status >= 500) {
    return new Error(`Cursor server error (${result.status}) — try again`);
  }
  if (result.status && (result.status < 200 || result.status >= 300)) {
    return new Error(`Cursor request failed with HTTP ${result.status}`);
  }
  return new Error("Cursor connection closed before the response completed");
}

function recordToolCall(live: LiveBridge, exec: PendingExec): void {
  live.pendingExecs.push(exec);
  live.currentTurn.steps.push({
    kind: "toolCall",
    toolCallId: exec.toolCallId,
    toolName: exec.toolName,
    arguments: exec.decodedArgs,
  });
}

function startOutputSegment(
  live: LiveBridge,
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  stream: AssistantMessageEventStream,
): void {
  const output = createOutput(model);
  const thinkingFilter = createThinkingFilter();
  let finished = false;
  let activeBlock: { index: number; type: "text" | "thinking" } | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSegmentHandlers = () => {
    if (stallTimer) clearTimeout(stallTimer);
    live.onActivity = undefined;
    live.onText = undefined;
    live.onExec = undefined;
    live.onEnd = undefined;
    live.onClose = undefined;
  };

  const finishBlock = () => {
    if (!activeBlock) return;
    const block = output.content[activeBlock.index];
    if (activeBlock.type === "text" && block?.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex: activeBlock.index,
        content: block.text,
        partial: output,
      });
    } else if (activeBlock.type === "thinking" && block?.type === "thinking") {
      stream.push({
        type: "thinking_end",
        contentIndex: activeBlock.index,
        content: block.thinking,
        partial: output,
      });
    }
    activeBlock = undefined;
  };

  const appendDelta = (type: "text" | "thinking", delta: string) => {
    if (!delta || finished) return;
    if (activeBlock?.type !== type) {
      finishBlock();
      const index = output.content.length;
      if (type === "text") output.content.push({ type: "text", text: "" });
      else output.content.push({ type: "thinking", thinking: "" });
      activeBlock = { index, type };
      stream.push(
        type === "text"
          ? { type: "text_start", contentIndex: index, partial: output }
          : { type: "thinking_start", contentIndex: index, partial: output },
      );
    }
    const block = output.content[activeBlock.index];
    if (type === "text" && block.type === "text") {
      block.text += delta;
      appendAssistantText(live.currentTurn, delta);
      stream.push({
        type: "text_delta",
        contentIndex: activeBlock.index,
        delta,
        partial: output,
      });
    } else if (type === "thinking" && block.type === "thinking") {
      block.thinking += delta;
      stream.push({
        type: "thinking_delta",
        contentIndex: activeBlock.index,
        delta,
        partial: output,
      });
    }
  };

  const emitToolCall = (exec: PendingExec) => {
    if (finished) return;
    finishBlock();
    const index = output.content.length;
    const toolCall: ToolCall = {
      type: "toolCall",
      id: exec.toolCallId,
      name: exec.toolName,
      arguments: exec.decodedArgs,
    };
    output.content.push(toolCall);
    stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
    stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: JSON.stringify(exec.decodedArgs),
      partial: output,
    });
    stream.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall,
      partial: output,
    });
  };

  const finishError = (error: Error, aborted = false) => {
    if (finished) return;
    finished = true;
    finishBlock();
    clearSegmentHandlers();
    restoreCheckpoint(live);
    detachBridge(live);
    if (live.bridge.alive) live.bridge.destroy(error);
    if (live.ephemeral) conversations.delete(live.key);
    output.stopReason = aborted ? "aborted" : "error";
    output.errorMessage = error.message;
    updateUsage(live, model, output);
    stream.push({
      type: "error",
      reason: aborted ? "aborted" : "error",
      error: output,
    });
    stream.end(output);
  };

  const finishSuccess = () => {
    if (finished) return;
    const flushed = thinkingFilter.flush();
    appendDelta("thinking", flushed.thinking);
    appendDelta("text", flushed.text);
    finished = true;
    finishBlock();
    clearSegmentHandlers();
    persistConversation(live);
    detachBridge(live);
    live.bridge.end();
    if (live.ephemeral) conversations.delete(live.key);
    output.stopReason = "stop";
    updateUsage(live, model, output);
    stream.push({ type: "done", reason: "stop", message: output });
    stream.end(output);
  };

  const finishForTools = (exec: PendingExec) => {
    if (finished) return;
    emitToolCall(exec);
    finished = true;
    finishBlock();
    if (stallTimer) clearTimeout(stallTimer);
    live.onActivity = undefined;
    live.onText = undefined;
    live.onExec = undefined;
    live.onEnd = undefined;
    live.onClose = undefined;
    live.waitingForTools = true;
    output.stopReason = "toolUse";
    updateUsage(live, model, output);
    stream.push({ type: "done", reason: "toolUse", message: output });
    stream.end(output);
  };

  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const error = new Error("Cursor did not respond for 120 seconds — try again");
      finishError(error);
      live.bridge.destroy(error);
    }, STREAM_STALL_TIMEOUT_MS);
    stallTimer.unref();
  };

  live.state.outputTokens = 0;
  live.waitingForTools = false;
  live.onActivity = resetStallTimer;
  live.onText = (text, thinking) => {
    resetStallTimer();
    if (thinking) {
      appendDelta("thinking", text);
      return;
    }
    const filtered = thinkingFilter.process(text);
    appendDelta("thinking", filtered.thinking);
    appendDelta("text", filtered.text);
  };
  live.onExec = (exec) => {
    resetStallTimer();
    finishForTools(exec);
  };
  live.onEnd = (data) => {
    resetStallTimer();
    const error = parseEndStream(data);
    if (error) finishError(new Error(error));
    else finishSuccess();
  };
  live.onClose = (error) => finishError(error, options?.signal?.aborted);

  stream.push({ type: "start", partial: output });
  resetStallTimer();
  if (options?.signal?.aborted) {
    finishError(new Error("Request aborted"), true);
  }
}

function installBridgeParser(live: LiveBridge): void {
  live.bridge.onData(
    createConnectFrameParser(
      (bytes) => {
        live.onActivity?.();
        try {
          const message = fromBinary(AgentServerMessageSchema, bytes);
          processServerMessage(
            live,
            message,
            (text, thinking) => live.onText?.(text, thinking),
            (exec) => {
              recordToolCall(live, exec);
              live.onExec?.(exec);
            },
          );
        } catch (error) {
          live.onClose?.(
            error instanceof Error ? error : new Error(String(error)),
          );
          live.bridge.destroy(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
      (bytes) => {
        live.onActivity?.();
        live.onEnd?.(bytes);
      },
    ),
  );

  void live.bridge.closed.then((result) => {
    if (liveBridges.get(live.key) !== live) return;
    detachBridge(live);
    restoreCheckpoint(live);
    if (live.ephemeral) conversations.delete(live.key);
    if (live.waitingForTools) return;
    const notify = live.onClose;
    live.onClose = undefined;
    notify?.(classifyTransportError(result));
  });
}

function createMcpResultMessage(
  exec: PendingExec,
  result: { content: string; isError: boolean },
): AgentClientMessage {
  const mcpResult = create(McpResultSchema, {
    result: result.isError
      ? {
        case: "error",
        value: create(McpErrorSchema, { error: result.content }),
      }
      : {
        case: "success",
        value: create(McpSuccessSchema, {
          content: [create(McpToolResultContentItemSchema, {
            content: {
              case: "text",
              value: create(McpTextContentSchema, { text: result.content }),
            },
          })],
          isError: false,
        }),
      },
  });
  return create(AgentClientMessageSchema, {
    message: {
      case: "execClientMessage",
      value: create(ExecClientMessageSchema, {
        id: exec.execMsgId,
        execId: exec.execId,
        message: { case: "mcpResult", value: mcpResult },
      }),
    },
  });
}

async function invokePayloadHook<T>(
  payload: T,
  model: Model<Api>,
  options?: SimpleStreamOptions,
): Promise<T> {
  const replacement = await options?.onPayload?.(payload, model);
  return replacement === undefined ? payload : replacement as T;
}

function ensureBridgeIsCurrent(live: LiveBridge): void {
  if (liveBridges.get(live.key) !== live || !live.bridge.alive) {
    throw new Error("Cursor connection lost while resuming tool results");
  }
}

async function resumeBridge(
  live: LiveBridge,
  parsed: ParsedContext,
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> {
  for (const result of parsed.toolResults) {
    const step = live.currentTurn.steps.find(
      (candidate): candidate is ParsedToolCallStep =>
        candidate.kind === "toolCall" && candidate.toolCallId === result.toolCallId,
    );
    if (step) step.result = { content: result.content, isError: result.isError };
  }

  const results = new Map(
    live.currentTurn.steps.flatMap((step) =>
      step.kind === "toolCall" && step.result
        ? [[step.toolCallId, step.result] as const]
        : [],
    ),
  );
  const unresolved = live.pendingExecs.filter((exec) => !results.has(exec.toolCallId));
  await options?.onResponse?.(live.response, model);
  ensureBridgeIsCurrent(live);
  if (unresolved.length > 0) {
    const output = createOutput(model);
    stream.push({ type: "start", partial: output });
    for (const exec of unresolved) {
      const index = output.content.length;
      const toolCall: ToolCall = {
        type: "toolCall",
        id: exec.toolCallId,
        name: exec.toolName,
        arguments: exec.decodedArgs,
      };
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
      stream.push({
        type: "toolcall_delta",
        contentIndex: index,
        delta: JSON.stringify(exec.decodedArgs),
        partial: output,
      });
      stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
    }
    output.stopReason = "toolUse";
    updateUsage(live, model, output);
    stream.push({ type: "done", reason: "toolUse", message: output });
    stream.end(output);
    return;
  }

  const messages = live.pendingExecs.flatMap((exec) => {
    const result = results.get(exec.toolCallId);
    return result ? [createMcpResultMessage(exec, result)] : [];
  });
  const rewritten = await invokePayloadHook(messages, model, options);
  ensureBridgeIsCurrent(live);
  for (const message of rewritten) sendClientMessage(live.bridge, message);
  live.pendingExecs = [];
  startOutputSegment(live, model, options, stream);
}

async function startBridge(
  key: string,
  ephemeral: boolean,
  parsed: ParsedContext,
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> {
  const existing = liveBridges.get(key);
  if (existing) {
    closeBridge(existing, new Error("A newer request replaced this Cursor request"));
  }

  const stored = getConversation(key);
  if (stored.checkpoint && !checkpointMatches(stored, parsed.turns)) {
    resetConversation(stored);
  }

  let turns = parsed.turns;
  let userText = parsed.userText;
  let userImages = parsed.userImages;
  let resume = false;
  if (parsed.toolResults.length > 0 && parsed.openTurn) {
    turns = [...turns, parsed.openTurn];
    userText = "";
    userImages = [];
    resume = true;
    if (stored.checkpoint) resetConversation(stored);
  } else if (!userText && parsed.toolResults.length > 0) {
    userText = parsed.toolResults.map((result) => result.content).join("\n");
  }

  const reasoning = options?.reasoning;
  const mappedReasoning = reasoning
    ? model.thinkingLevelMap?.[reasoning]
    : undefined;
  const offEffort = model.thinkingLevelMap?.off;
  let cursorEffort: string | undefined = reasoning
    ?? (typeof offEffort === "string" ? offEffort : undefined);
  if (typeof mappedReasoning === "string") cursorEffort = mappedReasoning;
  const modelId = resolveCursorWireModelId(
    model.id,
    cursorEffort,
  );
  const request = buildRunRequest({
    modelId,
    systemPrompt: parsed.systemPrompt,
    userText,
    userImages,
    turns,
    conversationId: stored.conversationId,
    checkpoint: stored.checkpoint,
    blobs: stored.blobStore,
    resume,
  });
  const clientMessage = await invokePayloadHook(request.message, model, options);
  const bridge = await bridgeFactory({
    accessToken: options?.apiKey ?? "",
    rpcPath: "/agent.v1.AgentService/Run",
    env: options?.env,
    signal: options?.signal,
  });
  const heartbeatTimer = setInterval(() => bridge.write(makeHeartbeat()), 5_000);
  heartbeatTimer.unref();
  const live: LiveBridge = {
    bridge,
    key,
    ephemeral,
    blobStore: request.blobs,
    mcpTools: buildMcpTools(parsed.tools),
    pendingExecs: [],
    currentTurn: { userText, images: userImages, steps: [] },
    completedTurns: turns,
    state: {
      outputTokens: 0,
      totalTokens: stored.lastTotalTokens ?? 0,
      cursorContextWindow: stored.effectiveContextWindow ?? 0,
      inferredContextWindow: model.contextWindow,
    },
    preTurnCheckpoint: stored.checkpoint
      ? new Uint8Array(stored.checkpoint)
      : null,
    latestCheckpoint: null,
    heartbeatTimer,
    waitingForTools: false,
    response: { status: 0, headers: {} },
  };
  liveBridges.set(key, live);
  bridge.write(frameConnectMessage(toBinary(AgentClientMessageSchema, clientMessage)));

  try {
    const responseTimeoutMs = options?.timeoutMs ?? STREAM_STALL_TIMEOUT_MS;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const responseTimeout = new Promise<never>((_resolve, reject) => {
      responseTimer = setTimeout(() => {
        const error = new Error("Cursor did not return response headers in time");
        bridge.destroy(error);
        reject(error);
      }, responseTimeoutMs);
      responseTimer.unref();
    });
    try {
      live.response = await Promise.race([bridge.response, responseTimeout]);
    } finally {
      if (responseTimer) clearTimeout(responseTimer);
    }
    await options?.onResponse?.(live.response, model);
    if (live.response.status < 200 || live.response.status >= 300) {
      throw classifyTransportError({ status: live.response.status });
    }
    startOutputSegment(live, model, options, stream);
    installBridgeParser(live);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    closeBridge(live, failure);
    if (live.ephemeral) conversations.delete(key);
    const output = createOutput(model);
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = failure.message;
    stream.push({
      type: "error",
      reason: output.stopReason === "aborted" ? "aborted" : "error",
      error: output,
    });
    stream.end(output);
  }
}

async function runCursorStream(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> {
  if (!options?.apiKey) throw new Error("Cursor is not signed in");
  const parsed = parseContext(context);
  if (!parsed.userText && parsed.userImages.length === 0 && parsed.toolResults.length === 0) {
    throw new Error("No user message found");
  }
  const identity = sessionKey(options.sessionId);
  const live = liveBridges.get(identity.key);
  if (live && parsed.toolResults.length > 0 && live.bridge.alive) {
    try {
      await resumeBridge(live, parsed, model, options, stream);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      closeBridge(live, failure);
      throw failure;
    }
    return;
  }
  if (live) closeBridge(live, new Error("A newer request replaced this Cursor request"));
  await startBridge(identity.key, identity.ephemeral, parsed, model, options, stream);
}

export function streamCursor(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    void runCursorStream(model, context, options, stream).catch((error) => {
      const output = createOutput(model);
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({
        type: "error",
        reason: output.stopReason === "aborted" ? "aborted" : "error",
        error: output,
      });
      stream.end(output);
    });
  });
  return stream;
}
