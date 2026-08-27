"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { createPortal } from "react-dom";
import { parseOpenWithConfig, resolveOpenWithTargets, openWithUrl } from "./open-with";
function launchTarget(target, path, adapter) {
    var _a, _b;
    if (target.kind === "reveal") {
        (_a = adapter.launchExternal) === null || _a === void 0 ? void 0 : _a.call(adapter, { action: "reveal", path });
    }
    else {
        const url = openWithUrl(target, path, parseOpenWithConfig(undefined));
        if (url !== undefined)
            (_b = adapter.launchExternal) === null || _b === void 0 ? void 0 : _b.call(adapter, { action: "url", url });
    }
}
/** Right-click context menu for a file/directory row (host-agnostic): open,
 *  open in app (external editors), copy relative/absolute path, download. */
export function FileRowContextMenu({ node, x, y, cwd, onOpen, onClose, adapter }) {
    const [submenuOpen, setSubmenuOpen] = useState(false);
    const copyText = (text) => {
        var _a;
        if (adapter.copy) {
            adapter.copy(text);
        }
        else {
            void ((_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.writeText(text).catch(() => { }));
        }
        onClose();
    };
    const downloadFile = () => {
        const url = "/api/files/" + encodeURIComponent(node.fullPath) + "?type=download";
        const a = document.createElement("a");
        a.href = url;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        onClose();
    };
    const menuStyle = {
        position: "fixed",
        top: typeof window !== "undefined" ? Math.max(8, Math.min(y, window.innerHeight - 180)) : y,
        left: typeof window !== "undefined" ? Math.max(8, Math.min(x, window.innerWidth - 220)) : x,
        zIndex: 3000,
        minWidth: 180,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        fontSize: 12,
    };
    const itemStyle = {
        position: "relative",
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px", border: "none", borderRadius: 6,
        background: "none", color: "var(--text)", cursor: "pointer",
        textAlign: "left", whiteSpace: "nowrap",
    };
    const submenuStyle = {
        position: "absolute",
        left: "100%",
        top: -4,
        marginLeft: 2,
        minWidth: 150,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        fontSize: 12,
    };
    const relPath = cwd ? node.fullPath.slice(node.fullPath.indexOf(cwd) + cwd.length + 1) : node.fullPath;
    const targets = resolveOpenWithTargets(parseOpenWithConfig(undefined));
    const L = adapter.labels;
    const content = (_jsxs(_Fragment, { children: [_jsx("div", { style: { position: "fixed", inset: 0, zIndex: 2999 }, onClick: onClose, onContextMenu: (e) => { e.preventDefault(); onClose(); } }), _jsxs("div", { role: "menu", style: menuStyle, onContextMenu: (e) => e.preventDefault(), children: [!node.isDir && onOpen !== undefined && (_jsxs("button", { type: "button", role: "menuitem", style: itemStyle, onClick: () => { onOpen(); onClose(); }, children: [_jsx("span", { children: "\u25B8" }), L.open] })), !node.isDir && adapter.launchExternal !== undefined && targets.length > 0 && (_jsxs("div", { role: "menuitem", "aria-haspopup": "menu", "aria-expanded": submenuOpen, style: itemStyle, onMouseEnter: () => setSubmenuOpen(true), onMouseLeave: () => setSubmenuOpen(false), onClick: () => setSubmenuOpen((v) => !v), children: [_jsx("span", { children: "\u2197" }), _jsx("span", { style: { flex: 1 }, children: L.openInApp }), _jsx("span", { style: { color: "var(--text-dim)" }, children: "\u203A" }), submenuOpen && (_jsx("div", { role: "menu", style: submenuStyle, children: targets.map((target) => {
                                    var _a;
                                    return (_jsxs("button", { type: "button", role: "menuitem", style: itemStyle, onClick: () => { launchTarget(target, node.fullPath, adapter); onClose(); }, children: [_jsx("span", { children: target.id === "explorer" ? "🗀" : target.id === "vscode" ? "⌨" : target.id === "cursor" ? "⌖" : "▣" }), _jsx("span", { children: (_a = L.openWith[target.id]) !== null && _a !== void 0 ? _a : target.name })] }, target.id));
                                }) }))] })), _jsxs("button", { type: "button", role: "menuitem", style: itemStyle, onClick: () => copyText(relPath), children: [_jsx("span", { children: "\u29C9" }), L.copyRelative] }), _jsxs("button", { type: "button", role: "menuitem", style: itemStyle, onClick: () => copyText(node.fullPath), children: [_jsx("span", { children: "\u29C9" }), L.copyAbsolute] }), !node.isDir && (_jsxs("button", { type: "button", role: "menuitem", style: itemStyle, onClick: downloadFile, children: [_jsx("span", { children: "\u2193" }), L.download] }))] })] }));
    if (typeof document !== "undefined") {
        return createPortal(content, document.body);
    }
    return content;
}
//# sourceMappingURL=FileRowContextMenu.js.map