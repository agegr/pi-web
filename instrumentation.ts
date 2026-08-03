export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [dispatcher, networkProxy] = await Promise.all([
    import("@/lib/http-dispatcher"),
    import("@/lib/network-proxy"),
  ]);
  const { effective } = await networkProxy.resolveEffectiveNetworkProxy();
  await dispatcher.applyEffectiveProxyConfiguration(effective);
}
