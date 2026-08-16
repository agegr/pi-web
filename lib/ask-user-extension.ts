import { Type } from "typebox";
import type { Static } from "typebox";
import type {
  AgentToolResult,
  InlineExtension,
  LoadExtensionsResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUiContextLike } from "./pi-types";

/** Built-in question tool name (takes priority over third-party ask_user extensions). */
export const ASK_USER_TOOL_NAME = "ask_user";
/** Built-in extension name used to identify the host extension in load results. */
export const HOST_ASK_EXTENSION_NAME = "pi-web-ask-user";
/** Virtual path of the built-in extension in load results (matches pi's <inline:...> convention). */
export const HOST_ASK_EXTENSION_PATH = `<inline:${HOST_ASK_EXTENSION_NAME}>`;

/** Text returned to the model when the user dismisses the question. */
const DISMISSED_MESSAGE = "User dismissed the question (no answer provided)";

const askUserParameters = Type.Object({
  question: Type.String({
    description: "The question to ask the user, concise and clear.",
  }),
  context: Type.Optional(
    Type.String({
      description: "Background: why this information is needed and how it will be used.",
    }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ description: "Option text shown to the user." }),
        description: Type.Optional(
          Type.String({ description: "Optional supplementary description for the option." }),
        ),
      }),
      { description: "Suggested options; omit to show a plain-text input question." },
    ),
  ),
  allowMultiple: Type.Optional(
    Type.Boolean({
      description: "Whether multiple selection is allowed. Default false (single-select).",
    }),
  ),
  allowFreeform: Type.Optional(
    Type.Boolean({
      description: "Whether the user may type a custom answer (the \"Other\" input). Default true.",
    }),
  ),
});

type AskUserParameters = Static<typeof askUserParameters>;

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * Create the built-in ask_user tool definition.
 *
 * The tool asks the user through pi-web's built-in extension UI channel:
 * enhanced select (multi-select, custom answer, context) when options are
 * provided, plain input otherwise. It is a pi-web built-in capability that
 * needs no third-party plugin; on a same-name conflict,
 * preferHostAskExtension() keeps this built-in version (it carries the UI).
 *
 * @returns The tool definition registered into the extension runtime
 */
export function createAskUserToolDefinition(): ToolDefinition<
  typeof askUserParameters
> {
  return {
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      "Ask the user a question when clarification, a choice, or preference/context gathering is needed. "
      + "Supports single/multi-choice, custom answers, and plain-text questions. "
      + "Use only when user input is genuinely required; never for confirmations you could infer yourself.",
    promptSnippet:
      "Ask the user one focused question with optional multiple-choice answers to gather information interactively.",
    parameters: askUserParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const {
        question,
        context,
        options = [],
        allowMultiple = false,
        allowFreeform = true,
      } = params as AskUserParameters;
      const ui = ctx.ui as unknown as ExtensionUiContextLike;

      if (options.length === 0) {
        const answer = await ui.input(question, undefined, { signal });
        if (answer === undefined || answer.trim() === "") {
          return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
        }
        return textResult(`User answer to "${question}": ${answer.trim()}`);
      }

      const selected = await ui.select(question, options, {
        signal,
        multiSelect: allowMultiple,
        allowFreeform,
        ...(context !== undefined ? { context } : {}),
      });
      if (selected === undefined) {
        return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
      }
      const answers = (Array.isArray(selected) ? selected : [selected])
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (answers.length === 0) {
        return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
      }
      return textResult(`User answer to "${question}": ${answers.join(", ")}`);
    },
  };
}

/**
 * Create the built-in ask_user inline extension.
 *
 * Injected as an extensionFactory like createProjectCommandBashExtension():
 * visible to every model in every session, with no plugin install required.
 *
 * @returns The inline extension registering the ask_user tool
 */
export function createAskUserExtension(): InlineExtension {
  return {
    name: HOST_ASK_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool(createAskUserToolDefinition());
    },
  };
}

/**
 * Post-process the extension load result so the built-in ask_user wins over
 * third-party extensions with the same tool name.
 *
 * pi loads user extensions before inline factories; the first registrar owns
 * a tool name and later ones produce a conflict diagnostic. The built-in
 * ask_user carries the full UI implementation, so this:
 * - strips the ask_user tool from conflicting third-party extensions (keeping
 *   their other tools), and
 * - clears the conflict diagnostics attributed to the built-in extension.
 *
 * @param base The raw extension load result from the loader
 * @returns The processed load result
 */
export function preferHostAskExtension(
  base: LoadExtensionsResult,
): LoadExtensionsResult {
  const hostAsk = base.extensions.find(
    (extension) => extension.path === HOST_ASK_EXTENSION_PATH,
  );
  if (!hostAsk) return base;

  const conflicting = base.extensions.filter(
    (extension) =>
      extension.path !== HOST_ASK_EXTENSION_PATH &&
      extension.tools.has(ASK_USER_TOOL_NAME),
  );
  if (conflicting.length === 0) return base;

  const conflictingPaths = new Set(
    conflicting.map((extension) => extension.path),
  );
  return {
    ...base,
    extensions: base.extensions.map((extension) => {
      if (!conflictingPaths.has(extension.path)) return extension;
      return {
        ...extension,
        tools: new Map(
          [...extension.tools].filter(
            ([toolName]) => toolName !== ASK_USER_TOOL_NAME,
          ),
        ),
      };
    }),
    errors: base.errors.filter(
      (error) =>
        error.path !== HOST_ASK_EXTENSION_PATH ||
        !error.error.includes(`Tool "${ASK_USER_TOOL_NAME}" conflicts`),
    ),
  };
}
