export function getObjectViewResultToArray(doc) {
    return doc?.rows.map(item => item.value).filter((val) => !!val) ?? [];
}
/** Makes sure that a host id starts with "system.host." */
export function normalizeHostId(host) {
    if (!host?.startsWith('system.host.')) {
        host = `system.host.${host}`;
    }
    return host;
}
export function objectIdToHostname(id) {
    if (id?.startsWith('system.host.')) {
        id = id.substring('system.host.'.length);
    }
    return id;
}
/**
 * Creates a promise that waits for the specified time and then resolves
 */
export function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
/** Converts ioB pattern into regex */
export function pattern2RegEx(pattern) {
    pattern = (pattern || '').toString();
    const startsWithWildcard = pattern[0] === '*';
    const endsWithWildcard = pattern[pattern.length - 1] === '*';
    pattern = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
    return (startsWithWildcard ? '' : '^') + pattern + (endsWithWildcard ? '' : '$');
}
//# sourceMappingURL=tools.js.map