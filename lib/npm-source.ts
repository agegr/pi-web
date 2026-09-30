export type ParsedNpmSource = {
  name: string;
  spec: string;
  version?: string;
};

/**
 * Split a pi package source such as `npm:@scope/pkg@1.2.3` into its package
 * name, the spec after `npm:`, and the pinned version. Non-npm sources return
 * undefined. Kept free of Node and SDK imports so both the plugin update check
 * and subagent selector resolution can share it.
 */
export function parseNpmSource(source: string): ParsedNpmSource | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice(4).trim();
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  return {
    name: match?.[1] ?? spec,
    spec,
    version: match?.[2],
  };
}
