/**
 * pi-web-queue-actions.cjs
 *
 * Safe, atomic in-memory queue operations for Pi Web v2.
 * Supports image attachment metadata, single-item recall/delete, promote, and all-item recall.
 *
 * Micro-contract v2:
 * - snapshot(session): { version: 2, steering: [{ token, text, imageCount }], followUp: [{ token, text, imageCount }] }
 * - getQueuedMessage(session, token): { text, kind, token, images: [{ data, mimeType }] }
 * - promote(session, token): { version: 2, queuedMessages: { steering: [text], followUp: [text] } }
 * - recall(session, token): { version: 2, text, kind, token, images: [{ data, mimeType }], rawMessage }
 * - deleteQueued(session, token): { version: 2, success: true }
 * - recallAll(session, expectedTokens?): { version: 2, entries: [{ text, kind, token, images, rawMessage }] }
 */

"use strict";

const crypto = require("node:crypto");

// Session-scoped token state storage.
// Guarantees:
// 1. In-process stable UUID per raw message object within a session.
// 2. Session isolation (tokens from session A cannot be resolved in session B).
// 3. Stale token rejection (tokens not present in the current active queues are rejected).
// 4. Zero memory leaks (weakly holds session reference).
const sessionTokenRegistries = new WeakMap();

class SessionTokenRegistry {
  constructor() {
    this.msgToToken = new WeakMap();
    this.tokenToMsg = new Map();
  }

  getOrCreateToken(msg) {
    let token = this.msgToToken.get(msg);
    if (!token) {
      token = crypto.randomUUID();
      this.msgToToken.set(msg, token);
      this.tokenToMsg.set(token, msg);
    } else if (!this.tokenToMsg.has(token)) {
      this.tokenToMsg.set(token, msg);
    }
    return token;
  }

  prune(activeMessages) {
    const activeSet = new Set(activeMessages);
    for (const [tok, msg] of this.tokenToMsg.entries()) {
      if (!activeSet.has(msg)) {
        this.tokenToMsg.delete(tok);
      }
    }
  }

  findMessage(token, activeMessages) {
    if (typeof token !== "string" || !token.trim()) return null;
    const msg = this.tokenToMsg.get(token);
    if (!msg) return null;
    if (!activeMessages.includes(msg)) {
      this.tokenToMsg.delete(token);
      return null;
    }
    return msg;
  }

  removeToken(token) {
    this.tokenToMsg.delete(token);
  }
}

/**
 * Get or create the SessionTokenRegistry for a session.
 * @param {object} session
 * @returns {SessionTokenRegistry}
 */
function getSessionRegistry(session) {
  let reg = sessionTokenRegistries.get(session);
  if (!reg) {
    reg = new SessionTokenRegistry();
    sessionTokenRegistries.set(session, reg);
  }
  return reg;
}

/**
 * Extract plain text content from an AgentMessage.
 * Preserves text ordering and ignores non-text parts (e.g. image attachments).
 * @param {object} msg
 * @returns {string}
 */
function extractMessageText(msg) {
  if (!msg) return "";
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

/**
 * Fast count of image attachments without building base64 string copies.
 * @param {object} msg
 * @returns {number}
 */
function countMessageImages(msg) {
  if (!msg || !Array.isArray(msg.content)) return 0;
  let count = 0;
  for (const part of msg.content) {
    if (part && part.type === "image") count++;
  }
  return count;
}

/**
 * Extract image attachments from an AgentMessage.
 * Preserves full data and mimeType.
 * @param {object} msg
 * @returns {Array<{ data: string, mimeType: string }>}
 */
function extractMessageImages(msg) {
  if (!msg || !Array.isArray(msg.content)) return [];
  const images = [];
  for (const part of msg.content) {
    if (part && part.type === "image") {
      if (typeof part.data === "string" && part.data.length > 0) {
        const mimeType = typeof part.mimeType === "string" && part.mimeType.startsWith("image/") ? part.mimeType : "image/png";
        images.push({ data: part.data, mimeType });
      }
    }
  }
  return images;
}

/**
 * Validate message attachment schema strictly before any mutation or read.
 * Incompatible schema (e.g. missing data or non-image mimeType) must fail closed.
 * @param {object} msg
 */
function validateMessageAttachmentSchema(msg) {
  if (!msg || !Array.isArray(msg.content)) return;
  for (const part of msg.content) {
    if (part && part.type === "image") {
      if (
        typeof part.data !== "string" ||
        part.data.length === 0 ||
        typeof part.mimeType !== "string" ||
        !part.mimeType.startsWith("image/")
      ) {
        throw new Error("Incompatible message attachment schema: invalid image part");
      }
    }
  }
}

/**
 * Strict validation of two-layer queue consistency between AgentSession and Agent.
 * Rejects with an Error if desynchronization or incompatible version is detected.
 * Does not mutate any state.
 * @param {object} session
 */
function validateQueueConsistency(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Invalid session: session must be an object");
  }

  if (typeof session._emitQueueUpdate !== "function") {
    throw new Error("Incompatible session: queue update emitter is required");
  }
  const agent = session.agent;
  if (!agent || typeof agent !== "object") {
    throw new Error("Incompatible session: session.agent is required");
  }

  if (!agent.followUpQueue || !Array.isArray(agent.followUpQueue.messages)) {
    throw new Error("Incompatible agent: followUpQueue.messages must be an array");
  }

  if (!agent.steeringQueue || !Array.isArray(agent.steeringQueue.messages)) {
    throw new Error("Incompatible agent: steeringQueue.messages must be an array");
  }

  if (!Array.isArray(session._followUpMessages)) {
    throw new Error("Incompatible session: _followUpMessages must be an array");
  }

  if (!Array.isArray(session._steeringMessages)) {
    throw new Error("Incompatible session: _steeringMessages must be an array");
  }

  // Length checks
  if (session._followUpMessages.length !== agent.followUpQueue.messages.length) {
    throw new Error(
      `Queue desynchronized: followUp queue length mismatch (_followUpMessages=${session._followUpMessages.length}, agent=${agent.followUpQueue.messages.length})`
    );
  }

  if (session._steeringMessages.length !== agent.steeringQueue.messages.length) {
    throw new Error(
      `Queue desynchronized: steering queue length mismatch (_steeringMessages=${session._steeringMessages.length}, agent=${agent.steeringQueue.messages.length})`
    );
  }

  // Content 1-to-1 correspondence checks & image schema checks
  for (let i = 0; i < session._followUpMessages.length; i++) {
    const textInSession = session._followUpMessages[i];
    const msg = agent.followUpQueue.messages[i];
    validateMessageAttachmentSchema(msg);
    const textInMsg = extractMessageText(msg);
    if (textInSession !== textInMsg) {
      throw new Error(
        `Queue desynchronized: followUp message mismatch at index ${i}`
      );
    }
  }

  for (let i = 0; i < session._steeringMessages.length; i++) {
    const textInSession = session._steeringMessages[i];
    const msg = agent.steeringQueue.messages[i];
    validateMessageAttachmentSchema(msg);
    const textInMsg = extractMessageText(msg);
    if (textInSession !== textInMsg) {
      throw new Error(
        `Queue desynchronized: steering message mismatch at index ${i}`
      );
    }
  }
}

/**
 * Safely emit queue update without letting subscriber errors mask committed state mutations.
 * @param {object} session
 */
function safeEmitQueueUpdate(session) {
  try {
    session._emitQueueUpdate();
  } catch (err) {
    console.warn("[pi-web-queue-actions] Queue mutated; a queue_update subscriber threw an error:", err?.message || err);
  }
}

/**
 * Snapshot steering and follow-up queue messages with stable UUID tokens and attachment counts.
 * Strictly read-only with respect to session queue state.
 *
 * @param {object} session AgentSession instance
 * @returns {{ version: 2, steering: Array<{ token: string, text: string, imageCount: number }>, followUp: Array<{ token: string, text: string, imageCount: number }> }}
 */
function snapshot(session) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawSteerings = session.agent.steeringQueue.messages;
  const rawFollowUps = session.agent.followUpQueue.messages;
  const allActive = [...rawSteerings, ...rawFollowUps];

  const steering = [];
  for (let i = 0; i < rawSteerings.length; i++) {
    const msg = rawSteerings[i];
    const token = registry.getOrCreateToken(msg);
    const text = session._steeringMessages[i];
    const imageCount = countMessageImages(msg);
    steering.push({ token, text, imageCount });
  }

  const followUp = [];
  for (let i = 0; i < rawFollowUps.length; i++) {
    const msg = rawFollowUps[i];
    const token = registry.getOrCreateToken(msg);
    const text = session._followUpMessages[i];
    const imageCount = countMessageImages(msg);
    followUp.push({ token, text, imageCount });
  }

  registry.prune(allActive);

  return {
    version: 2,
    steering,
    followUp,
  };
}

/**
 * Read-only fetch of a single queued message entry by its token.
 *
 * @param {object} session AgentSession instance
 * @param {string} token Stable UUID token
 * @returns {{ text: string, kind: "steering" | "followUp", token: string, images: Array<{ data: string, mimeType: string }> }}
 */
function getQueuedMessage(session, token) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Invalid token: token must be a non-empty string");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawSteerings = session.agent.steeringQueue.messages;
  const rawFollowUps = session.agent.followUpQueue.messages;
  const allActive = [...rawSteerings, ...rawFollowUps];

  const targetMsg = registry.findMessage(token, allActive);
  if (!targetMsg) {
    throw new Error(`Token invalid or message no longer in queue: ${token}`);
  }

  // Determine whether it is steering or followUp
  const steeringIdx = rawSteerings.indexOf(targetMsg);
  if (steeringIdx !== -1) {
    return {
      text: session._steeringMessages[steeringIdx],
      kind: "steering",
      token,
      images: extractMessageImages(targetMsg),
    };
  }

  const followUpIdx = rawFollowUps.indexOf(targetMsg);
  if (followUpIdx !== -1) {
    return {
      text: session._followUpMessages[followUpIdx],
      kind: "followUp",
      token,
      images: extractMessageImages(targetMsg),
    };
  }

  throw new Error(`Token invalid or message no longer in queue: ${token}`);
}

/**
 * Synchronous atomic promotion of a queued follow-up message into the steering queue.
 *
 * @param {object} session AgentSession instance
 * @param {string} token Stable UUID token
 * @returns {{ version: 2, queuedMessages: { steering: string[], followUp: string[] } }}
 */
function promote(session, token) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Invalid token: token must be a non-empty string");
  }

  const isStreaming = Boolean(session.isStreaming ?? session.agent?.state?.isStreaming);
  if (!isStreaming) {
    throw new Error("Cannot promote queued message: session is not streaming");
  }

  if (session.isCompacting) {
    throw new Error("Cannot promote queued message: session is currently compacting");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawFollowUps = session.agent.followUpQueue.messages;
  const targetMsg = registry.findMessage(token, rawFollowUps);

  if (!targetMsg) {
    throw new Error(`Token invalid or message no longer in follow-up queue: ${token}`);
  }

  const targetIndex = rawFollowUps.indexOf(targetMsg);
  if (targetIndex === -1) {
    throw new Error(`Token invalid or message no longer in follow-up queue: ${token}`);
  }

  // Synchronous atomic mutation: remove from followUp queues
  const [targetAgentMessage] = session.agent.followUpQueue.messages.splice(targetIndex, 1);
  const [targetFollowUpText] = session._followUpMessages.splice(targetIndex, 1);

  // Append to steering queues tail
  session.agent.steeringQueue.messages.push(targetAgentMessage);
  session._steeringMessages.push(targetFollowUpText);

  safeEmitQueueUpdate(session);

  return {
    version: 2,
    queuedMessages: {
      steering: [...session._steeringMessages],
      followUp: [...session._followUpMessages],
    },
  };
}

/**
 * Synchronous atomic recall of a single queued message into composer.
 * Removes the exact message object from the two-layer queue while keeping remaining messages intact.
 *
 * @param {object} session AgentSession instance
 * @param {string} token Stable UUID token
 * @returns {{ version: 2, text: string, kind: "steering" | "followUp", token: string, images: Array<{ data: string, mimeType: string }>, rawMessage: object }}
 */
function recall(session, token) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Invalid token: token must be a non-empty string");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawSteerings = session.agent.steeringQueue.messages;
  const rawFollowUps = session.agent.followUpQueue.messages;
  const allActive = [...rawSteerings, ...rawFollowUps];

  const targetMsg = registry.findMessage(token, allActive);
  if (!targetMsg) {
    throw new Error(`Token invalid or message no longer in queue: ${token}`);
  }

  let kind = null;
  let rawText = "";
  let removedMsg = null;

  const steeringIdx = rawSteerings.indexOf(targetMsg);
  if (steeringIdx !== -1) {
    kind = "steering";
    [removedMsg] = session.agent.steeringQueue.messages.splice(steeringIdx, 1);
    [rawText] = session._steeringMessages.splice(steeringIdx, 1);
  } else {
    const followUpIdx = rawFollowUps.indexOf(targetMsg);
    if (followUpIdx !== -1) {
      kind = "followUp";
      [removedMsg] = session.agent.followUpQueue.messages.splice(followUpIdx, 1);
      [rawText] = session._followUpMessages.splice(followUpIdx, 1);
    } else {
      throw new Error(`Token invalid or message no longer in queue: ${token}`);
    }
  }

  registry.removeToken(token);

  safeEmitQueueUpdate(session);

  return {
    version: 2,
    text: rawText,
    kind,
    token,
    images: extractMessageImages(removedMsg),
  };
}

/**
 * Synchronous atomic deletion of a single queued message.
 * Removes the exact message object from the two-layer queue.
 *
 * @param {object} session AgentSession instance
 * @param {string} token Stable UUID token
 * @returns {{ version: 2, success: true }}
 */
function deleteQueued(session, token) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Invalid token: token must be a non-empty string");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawSteerings = session.agent.steeringQueue.messages;
  const rawFollowUps = session.agent.followUpQueue.messages;
  const allActive = [...rawSteerings, ...rawFollowUps];

  const targetMsg = registry.findMessage(token, allActive);
  if (!targetMsg) {
    throw new Error(`Token invalid or message no longer in queue: ${token}`);
  }

  const steeringIdx = rawSteerings.indexOf(targetMsg);
  if (steeringIdx !== -1) {
    session.agent.steeringQueue.messages.splice(steeringIdx, 1);
    session._steeringMessages.splice(steeringIdx, 1);
  } else {
    const followUpIdx = rawFollowUps.indexOf(targetMsg);
    if (followUpIdx !== -1) {
      session.agent.followUpQueue.messages.splice(followUpIdx, 1);
      session._followUpMessages.splice(followUpIdx, 1);
    } else {
      throw new Error(`Token invalid or message no longer in queue: ${token}`);
    }
  }

  registry.removeToken(token);

  safeEmitQueueUpdate(session);

  return {
    version: 2,
    success: true,
  };
}

/**
 * Synchronous atomic recall of all queued messages into composer.
 * Strictly requires expectedTokens array to match active queue tokens exactly, then drains both queues.
 *
 * @param {object} session AgentSession instance
 * @param {string[]} expectedTokens Required expected token sequence
 * @returns {{ version: 2, entries: Array<{ text: string, kind: "steering" | "followUp", token: string, images: Array<{ data: string, mimeType: string }> }> }}
 */
function recallAll(session, expectedTokens) {
  if (!session) {
    throw new Error("Invalid session: session is required");
  }

  if (!Array.isArray(expectedTokens)) {
    throw new Error("expectedTokens is required and must be an array of string tokens");
  }

  validateQueueConsistency(session);

  const registry = getSessionRegistry(session);
  const rawSteerings = session.agent.steeringQueue.messages;
  const rawFollowUps = session.agent.followUpQueue.messages;

  // Build current token sequence
  const currentEntries = [];
  for (let i = 0; i < rawSteerings.length; i++) {
    const msg = rawSteerings[i];
    const tok = registry.getOrCreateToken(msg);
    currentEntries.push({
      text: session._steeringMessages[i],
      kind: "steering",
      token: tok,
      images: extractMessageImages(msg),
    });
  }
  for (let i = 0; i < rawFollowUps.length; i++) {
    const msg = rawFollowUps[i];
    const tok = registry.getOrCreateToken(msg);
    currentEntries.push({
      text: session._followUpMessages[i],
      kind: "followUp",
      token: tok,
      images: extractMessageImages(msg),
    });
  }

  const currentTokens = currentEntries.map((e) => e.token);
  if (
    currentTokens.length !== expectedTokens.length ||
    currentTokens.some((tok, idx) => tok !== expectedTokens[idx])
  ) {
    throw new Error("Queue state changed concurrently: expectedTokens mismatch");
  }

  // Atomic drain
  session.agent.steeringQueue.messages.length = 0;
  session._steeringMessages.length = 0;
  session.agent.followUpQueue.messages.length = 0;
  session._followUpMessages.length = 0;

  for (const entry of currentEntries) {
    registry.removeToken(entry.token);
  }

  safeEmitQueueUpdate(session);

  return {
    version: 2,
    entries: currentEntries,
  };
}

module.exports = {
  snapshot,
  getQueuedMessage,
  promote,
  recall,
  deleteQueued,
  recallAll,
  extractMessageText,
  countMessageImages,
  extractMessageImages,
  validateQueueConsistency,
  getSessionRegistry,
};
