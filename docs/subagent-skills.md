# Named skills in subagent profiles

Profiles can preload SDK-discovered skill instructions in either prompt mode:

```yaml
load_skills: true
skills: [code-review, testing]
prompt_mode: replace
```

A comma-separated scalar (`skills: code-review, testing`) also works. Names are
exact and case-sensitive, kept in order, and deduplicated. Named instructions
are included once, without a read-tool requirement or an additional automatic
skill catalog. Explicit selection also permits `disable-model-invocation` skills.

- `skills: []` or `skills: none` selects nothing, even with `load_skills: true`.
- `skills: true` (or an omitted selection) keeps SDK on-demand discovery rather
  than inserting all skill bodies. Replace mode advertises the SDK catalog only
  when `read` or `bash` is active; automatic invocation respects the skill's flag.
- `load_skills: false` wins over any selection. Existing Pi Web defaults and
  switch/alias precedence are unchanged.

Missing, unreadable, or unsafe names generate name-specific explanatory text;
other selected skills still load and the child continues. Names must start with
an alphanumeric character, contain only letters, numbers, dots, underscores or
hyphens, and be at most 128 characters. Names never become filesystem paths:
only the SDK's discovered file paths are read. Blocks identify their source
file and base directory for relative references, without frontmatter.

Resume and reopening retain declared names, not skill bodies or paths. Bodies
are reread for each logical run; newly installed skills require the ordinary
session reload, with existing project trust rules. Profile editing and
activation toggles preserve authored scalar/list selections and foreign keys.
There is no new scope picker; edit selections in the profile file. Malformed
persisted selections fail rather than silently widening to all skills.

This aligns named preloading and nonfatal diagnostics with tintinweb/pi-subagents,
not its scanner, raw-frontmatter injection, parent-prompt inheritance, symlink
policy, or default-on behavior. SDK discovery, collision precedence, packages,
settings and trust remain Pi Web's source of truth. Extension scope, MCP, tool
selection and session persistence policy are not changed by this feature.
