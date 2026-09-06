# Make Chat only a persisted resource policy

Pi Web treats an explicitly empty tool selection as **Chat only**, not merely as
an AgentSession whose active tool array happens to be empty.

For a normal session, Chat only loads no extensions, skills, prompt templates,
themes, or Pi base system prompt. Its exact system prompt is the ordered content
of the context files discovered by Pi's default loader, including global and
project `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md` files. Pi Web does not
add its own prefix, suffix, or current-working-directory text.

For a subagent whose resolved profile has no tools and has both resource-loading
switches disabled, Chat only loads no extensions, skills, prompt templates,
themes, context files, or Pi base system prompt. Its exact system prompt is the
profile system prompt. If parent context inheritance is enabled, that context is
included with the delegated user task instead of being appended to the system
prompt. A profile may opt into skills or extensions independently. Extension
tools are activated alongside the profile's built-in tools except for Pi Web's
reserved subagent-control tools, which remain excluded to prevent nested Agent
dispatch.

The host may resolve `input_files` before dispatch and include their UTF-8 text
in the delegated user task. This is input preparation, not a subagent tool: it
does not change the active tool list or the exact Chat-only system prompt.

Pi's native session format does not persist the active tool selection. Normal
sessions therefore append versioned `pi-web:tool-selection` custom entries:

```json
{
  "type": "custom",
  "customType": "pi-web:tool-selection",
  "data": { "version": 1, "tools": [] }
}
```

The latest valid entry is authoritative. No entry means a legacy session and
retains Pi's default behavior; an empty `tools` array means Chat only; a nonempty
array restores the selected built-in tools. The stored array is the user's
selection before extension tools are added. Subagents keep using
`resourceSnapshot` in their own metadata instead of duplicating this entry. The
snapshot records their active tools and the profile's skill and extension
loading switches so reopened sessions retain the same resource policy.

The persisted selection must be resolved before `createAgentSessionServices()`
so Chat only never imports or executes session extensions. The exact system
prompt must also be reapplied after Pi's `before_agent_start` phase, because the
SDK rebuilds its base prompt immediately before the model call.

Changing among nonempty tool presets can update an existing wrapper. Crossing
the Chat-only boundary must append the new selection and rebuild the wrapper:
normal wrappers have already loaded extensions, while Chat-only wrappers do not
have those resources available to enable in place. Persisted sessions retain
their id and JSONL file. An unpersisted empty composer session may be discarded
and recreated with a new internal id.
