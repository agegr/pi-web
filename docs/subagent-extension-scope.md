# Subagent extension loading scope

```yaml
extensions: [codegraph, '@team/adapter']
load_extensions: true
tools: read, ext:codegraph/query
```

`extensions` controls **entry-module and factory loading**, not just tools. The
separate `tools: ext:...` allow/deny policy still controls which loaded tools a
child exposes. A tool selector cannot grant an excluded extension permission to
load. Allowed extensions can still import their own dependencies: this is not
an OS sandbox.

Named CSV and string lists become ordered, case-insensitive unique identities.
An absent declaration (or `true`, `all`, `*`) keeps native discovery. `[]`,
`none`, and `false` select nothing. A named declaration enables loading unless
`load_extensions: false` explicitly disables it. Disabling retains the selection;
saves, the existing form and profile enable/disable PATCH preserve equivalent
hand-authored scalar/list spellings. Skill aliases and foreign fields are not
changed by this feature. There is no new scope-selection UI.

Names use the existing extension-tool ownership rules: file basename/parent
aliases and package source/npm scoped and unscoped names. Multiple files in one
package can share a package alias. Names claimed by different sources are
ambiguous and grant nothing; unknown or disabled identities also grant nothing.
Only complete extension identities authorize loading, never a `/tool` suffix.

## Settings, trust and builtins

Selection comes from SDK-enabled discovery after synchronizing Pi Web's current
project-trust decision and reloading settings. It cannot resurrect a disabled
package resource or an untrusted project extension. Only host-registered
`builtin: true` factories participate in builtin discovery. Address them as
`builtin:<name>`; the shared label `builtin` is not an identity. Settings such as
`-builtin:<name>` win. Pi Web does not automatically import CLI builtin factories.
Ordinary host inline factories, including the exact-prompt extension, remain
independent of this external loading scope.

Fresh children and RPC reopen use native services-first provider registration
before selecting/restoring models. Version-1 resource snapshots store only the
optional `extensionScope` declaration, not paths, code or factory objects. Old
snapshots without it retain native behavior. A present malformed scope throws
before ordinary startup fallback, including live-wrapper resume validation.

## SDK 0.99.1 compatibility adapter

The SDK has no pre-import predicate or custom-loader input to
`createAgentSessionServices`. The application adapter resolves resources through
public `DefaultPackageManager.resolve`, forces `noExtensions: true`, and supplies
only the eligible selected paths through one constructor-supplied
`additionalExtensionPaths` array. Original caller suppression still wins. Scoped
callers cannot supply arbitrary additional extension paths.

The SDK's retention of that array **by reference is an observed 0.99.1 contract,
not a supported filtering API**. Real loader tests pin content/deletion,
settings/package disable, trust changes and concurrent/failing reload behavior.
A public instance reload wrapper queues the entire trust/settings/discovery,
selection, array update, native reload and metadata restoration pass. Failures do
not call native reload with a stale grant or poison subsequent queued passes.
Initial scoped creation consumes inherited host trust options without running
the SDK's execution-producing pre-trust bootstrap; later explicit
`resolveProjectTrust` requests are rejected. Unscoped services delegate unchanged.

Original extension/tool/command ownership metadata is restored both before an
existing override callback and after the SDK's final source assignment. Native
service provider/native-provider/virtual-model registration, runtime cleanup and
cache invalidation are retained.

### Limits

- Discovery may reconcile packages, including installer side effects. Two SDK
  discovery passes are not an atomic filesystem/settings transaction; concurrent
  external edits between them are not covered by an isolation guarantee.
- Previously loaded `session_shutdown` handlers still run during normal cleanup.
  Revocation prevents re-import/re-registration, not rollback of earlier effects
  or already registered parent providers.
- Code freshness inherits SDK cache behavior. JS/TS reload tests observe changed
  code. Native Node ESM (`.mjs`) imports in SDK 0.99.1 retain Node's module cache:
  reload re-runs the cached factory, not the module's changed top-level code.
  Restart the host process for such changes. Pre-import exclusion, settings/trust
  revocation and deletion still apply to those entries. The adapter does not
  patch the SDK or attempt unsupported ESM cache invalidation.
- Re-run the real loader contract tests before upgrading the SDK. No dependency,
  postinstall or installed-source changes implement this boundary.
