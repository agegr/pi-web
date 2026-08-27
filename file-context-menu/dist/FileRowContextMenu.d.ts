export interface FileNodeLite {
    name: string;
    fullPath: string;
    isDir: boolean;
}
export interface FileContextMenuAdapter {
    /** Launch external ("open in app"): reveal in the OS file manager, or open a
     *  URL scheme (vscode://, cursor://, zed://, custom editors). Optional: when
     *  absent the menu hides the "open in app" entry. */
    launchExternal?(payload: {
        action: "reveal";
        path: string;
    } | {
        action: "url";
        url: string;
    }): void;
    /** Copy text to the clipboard (defaults to navigator.clipboard). */
    copy?(text: string): void;
    /** Menu labels (the host supplies localized strings). */
    labels: {
        open: string;
        openInApp: string;
        copyRelative: string;
        copyAbsolute: string;
        download: string;
        /** Label by open-with target id (explorer / vscode / cursor / zed / custom:<id>). */
        openWith: Record<string, string>;
    };
}
/** Right-click context menu for a file/directory row (host-agnostic): open,
 *  open in app (external editors), copy relative/absolute path, download. */
export declare function FileRowContextMenu({ node, x, y, cwd, onOpen, onClose, adapter }: {
    node: FileNodeLite;
    x: number;
    y: number;
    cwd: string;
    onOpen?: () => void;
    onClose: () => void;
    adapter: FileContextMenuAdapter;
}): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=FileRowContextMenu.d.ts.map