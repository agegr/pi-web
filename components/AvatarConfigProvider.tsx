"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AVATAR_CONFIG_ROLES,
  createEmptyAvatarConfig,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarConfigRole,
} from "@/lib/avatar-config";
import { responseError } from "@/lib/response-error";

/** Context shape exposed to descendants of `AvatarConfigProvider`. */
interface AvatarConfigContextValue {
  /** Current avatar record. Always a complete three-role record; missing or
   *  failed loads resolve to all-null defaults. */
  config: AvatarConfig;
  /** True while the initial fetch for the active cwd is in flight. */
  loading: boolean;
  /** Last load error message, if any. Cleared on the next successful load. */
  error: string | null;
  /** Cwd the current `config` was loaded for. */
  cwd: string | null;
  /** Replace the in-memory config (used after a successful save). */
  setConfig: (next: AvatarConfig) => void;
}

const AvatarConfigContext = createContext<AvatarConfigContextValue | null>(null);

/**
 * Loads `<cwd>/.pi/avatars.json` whenever the project cwd changes and
 * exposes the current config to descendants. With no cwd, the record stays
 * at all-null defaults and no fetch is issued.
 */
export function AvatarConfigProvider({
  cwd,
  initialConfig,
  children,
}: {
  cwd: string | null;
  /** Optional pre-seeded config. Useful for unit tests that want to render
   *  MessageView with a custom avatar without making a network call. In the
   *  app this is left undefined and the provider fetches from the API. */
  initialConfig?: AvatarConfig;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<AvatarConfig>(() => {
    if (initialConfig) {
      const normalized = createEmptyAvatarConfig();
      for (const role of AVATAR_CONFIG_ROLES) {
        const value = initialConfig[role];
        normalized[role] = typeof value === "string" ? value : null;
      }
      return normalized;
    }
    return createEmptyAvatarConfig();
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(cwd);

  useEffect(() => {
    setActiveCwd(cwd);
    if (!cwd) {
      setConfig(createEmptyAvatarConfig());
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setConfig(createEmptyAvatarConfig());
    setLoading(true);
    setError(null);
    void fetch(`/api/avatars?cwd=${encodeURIComponent(cwd)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(responseError(data) ?? `HTTP ${response.status}`);
        }
        setConfig(normalizeAvatarConfig(data));
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cwd]);

  const handleSetConfig = useCallback((next: AvatarConfig) => {
    const normalized = createEmptyAvatarConfig();
    for (const role of AVATAR_CONFIG_ROLES) {
      normalized[role] = typeof next[role] === "string" ? next[role] : null;
    }
    setConfig(normalized);
    setError(null);
  }, []);

  const value = useMemo<AvatarConfigContextValue>(
    () => ({
      config,
      loading,
      error,
      cwd: activeCwd,
      setConfig: handleSetConfig,
    }),
    [config, loading, error, activeCwd, handleSetConfig],
  );

  return (
    <AvatarConfigContext.Provider value={value}>
      {children}
    </AvatarConfigContext.Provider>
  );
}

export function useAvatarConfig(): AvatarConfigContextValue {
  const value = useContext(AvatarConfigContext);
  if (value) return value;
  // Defensive default so consumers like MessageView keep rendering default
  // avatars even if mounted outside a provider (isolated tests, pre-mount
  // frames). When there is no provider, avatars stay all-null and we
  // pretend the fetch completed successfully.
  return DEFAULT_AVATAR_CONTEXT_VALUE;
}

const DEFAULT_AVATAR_CONTEXT_VALUE: AvatarConfigContextValue = {
  config: {
    user: null,
    assistant: null,
    tool: null,
  },
  loading: false,
  error: null,
  cwd: null,
  setConfig: () => {},
};

export function useAvatarSrc(role: AvatarConfigRole): string | null {
  const { config } = useAvatarConfig();
  return config[role];
}
