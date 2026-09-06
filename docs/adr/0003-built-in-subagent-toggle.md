# Built-in sub-agent activation and extension precedence

Pi Web's integrated sub-agent implementation is an inline, hidden extension.
It is disabled by default and controlled by the global
`~/.pi/agent/agents/settings.json` setting `builtInEnabled`.

The inline extension factory remains installed in every ordinary, non-Chat-only
resource loader so an AgentSession reload can enable or disable its tools without
recreating the wrapper. When disabled, the factory registers no tools. A runtime
guard also rejects stale `Agent` calls after the setting is turned off but before
the parent session is reloaded.

When the integrated extension is enabled, it takes precedence over an enabled
legacy `pi-subagents` extension. A legacy extension is suppressed when its package
source or path identifies it as `pi-subagents` and it registers any of the reserved
tool names: `Agent`, `get_subagent_result`, or `steer_subagent`. Unrelated extensions
are never removed solely because they use one of those names; the SDK reports those
collisions normally.

When the integrated extension is disabled, Pi Web does not suppress the legacy
package, so users can continue to manage and use that implementation through the
Plugins settings. Existing child sessions remain readable, and already-running
children are not aborted when the setting changes.
