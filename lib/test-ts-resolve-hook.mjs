// Resolve hook for node --test only: lib/*.ts sources use extensionless
// relative imports (resolved by Next.js via bundler moduleResolution).
// Retrying a failed relative specifier with a .ts suffix lets plain node
// import those sources directly. Registered per-test-file; see
// lib/mcp-servers.test.mjs.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../"))
      && error?.code === "ERR_MODULE_NOT_FOUND"
      && !specifier.endsWith(".ts")
    ) {
      return await nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
