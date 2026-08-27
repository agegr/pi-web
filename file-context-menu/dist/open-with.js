/**
 * Pure "open with" vocabulary for the file context menu: which external
 * editors / file managers a row's path can be handed to, how the per-user
 * config (custom editors, SSH host, pinned ids) is parsed, and how the
 * external URL is built. Pure by design (no React / no host `api`), so it is
 * unit-testable and can live in a standalone package.
 */
export const OPEN_WITH_DEFAULTS = {
    sshHost: '',
    customEditors: [],
    pinned: [],
};
export const OPEN_WITH_BUILTINS = [
    { id: 'explorer', nameKey: 'explorer', name: '', kind: 'reveal', isVscodeFamily: false, localOnly: true },
    { id: 'vscode', nameKey: 'vscode', name: '', kind: 'url', urlTemplate: 'vscode://file/{path}', isVscodeFamily: true, localOnly: false },
    { id: 'cursor', nameKey: 'cursor', name: '', kind: 'url', urlTemplate: 'cursor://file/{path}', isVscodeFamily: true, localOnly: false },
    { id: 'zed', nameKey: 'zed', name: '', kind: 'url', urlTemplate: 'zed://file/{path}', isVscodeFamily: false, localOnly: true },
];
function isCustomEditor(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    return typeof record.id === 'string' && record.id !== ''
        && typeof record.name === 'string'
        && typeof record.urlTemplate === 'string'
        && typeof record.isVscodeFamily === 'boolean';
}
function isValidCustomEditor(row) {
    return row.name.trim() !== ''
        && row.urlTemplate.includes('{path}')
        && /^[a-z][a-z0-9+.-]*:\/\//i.test(row.urlTemplate.trim());
}
export function parseOpenWithConfig(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return { ...OPEN_WITH_DEFAULTS };
    const record = raw;
    const sshHost = typeof record.sshHost === 'string' ? record.sshHost : '';
    const customEditors = Array.isArray(record.customEditors)
        ? record.customEditors.filter(isCustomEditor)
        : [];
    const pinned = Array.isArray(record.pinned)
        ? record.pinned.filter((id) => typeof id === 'string' && id !== '')
        : [];
    return { sshHost, customEditors, pinned };
}
function customIdOf(id) {
    return 'custom:' + id;
}
export function resolveOpenWithTargets(config) {
    const ssh = config.sshHost.trim() !== '';
    const targets = [
        ...OPEN_WITH_BUILTINS,
        ...config.customEditors
            .filter(isValidCustomEditor)
            .map((editor) => ({
            id: customIdOf(editor.id),
            name: editor.name,
            kind: 'url',
            urlTemplate: editor.urlTemplate,
            isVscodeFamily: editor.isVscodeFamily,
            localOnly: !editor.isVscodeFamily,
        })),
    ];
    return targets.filter(target => !(ssh && target.localOnly));
}
export function openWithSshActive(config) {
    return config.sshHost.trim() !== '';
}
function schemeOf(template) {
    const at = template.indexOf(':');
    if (at <= 0)
        return undefined;
    const scheme = template.slice(0, at);
    return /^[a-z][a-z0-9+.-]*$/i.test(scheme) ? scheme : undefined;
}
export function normalizeUrlPath(path) {
    return path.replace(/\\/g, '/');
}
export function openWithUrl(target, path, config) {
    if (target.kind !== 'url' || target.urlTemplate === undefined)
        return undefined;
    const normalized = normalizeUrlPath(path);
    const ssh = openWithSshActive(config);
    if (ssh && target.isVscodeFamily) {
        const scheme = schemeOf(target.urlTemplate);
        if (scheme === undefined)
            return undefined;
        return scheme + '://vscode-remote/ssh-remote+' + config.sshHost.trim() + normalized;
    }
    if (!target.urlTemplate.includes('{path}') || !/^[a-z][a-z0-9+.-]*:\/\//i.test(target.urlTemplate))
        return undefined;
    return target.urlTemplate.replace('{path}', normalized);
}
//# sourceMappingURL=open-with.js.map