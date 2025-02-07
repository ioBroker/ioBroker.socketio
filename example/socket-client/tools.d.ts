export declare function getObjectViewResultToArray<T extends ioBroker.Object>(doc: {
    rows: ioBroker.GetObjectViewItem<T>[];
} | undefined): T[];
/** Makes sure that a host id starts with "system.host." */
export declare function normalizeHostId(host: string): string;
export declare function objectIdToHostname(id: string): string;
/**
 * Creates a promise that waits for the specified time and then resolves
 */
export declare function wait(ms: number): Promise<void>;
/** Converts ioB pattern into regex */
export declare function pattern2RegEx(pattern: string): string;
