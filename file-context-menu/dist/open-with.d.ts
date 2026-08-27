/**
 * Pure "open with" vocabulary for the file context menu: which external
 * editors / file managers a row's path can be handed to, how the per-user
 * config (custom editors, SSH host, pinned ids) is parsed, and how the
 * external URL is built. Pure by design (no React / no host `api`), so it is
 * unit-testable and can live in a standalone package.
 */
export interface CustomEditor {
    id: string;
    name: string;
    urlTemplate: string;
    isVscodeFamily: boolean;
}
export interface OpenWithConfig {
    sshHost: string;
    customEditors: CustomEditor[];
    pinned: string[];
}
export interface OpenWithTarget {
    id: string;
    nameKey?: string;
    name: string;
    kind: 'reveal' | 'url';
    urlTemplate?: string;
    isVscodeFamily: boolean;
    localOnly: boolean;
}
export declare const OPEN_WITH_DEFAULTS: OpenWithConfig;
export declare const OPEN_WITH_BUILTINS: readonly OpenWithTarget[];
export declare function parseOpenWithConfig(raw: unknown): OpenWithConfig;
export declare function resolveOpenWithTargets(config: OpenWithConfig): OpenWithTarget[];
export declare function openWithSshActive(config: OpenWithConfig): boolean;
export declare function normalizeUrlPath(path: string): string;
export declare function openWithUrl(target: OpenWithTarget, path: string, config: OpenWithConfig): string | undefined;
//# sourceMappingURL=open-with.d.ts.map