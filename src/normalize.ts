import { CycleCloudRequestError } from "./errors.js";

export interface ClusterSummary {
    readonly name: string;
    readonly state?: string;
    readonly targetState?: string;
    readonly fixedNodeDefinitions: number;
    readonly nodeArrayCount: number;
    readonly arrayNodeCount: number;
    readonly configuredNodeCount: number;
}

export interface ClusterListResult {
    readonly clusters: readonly ClusterSummary[];
    readonly total: number;
    readonly returned: number;
    readonly truncated: boolean;
}

export interface NodeArraySummary {
    readonly template: string;
    readonly state?: string;
    readonly targetState?: string;
    readonly count: number;
    readonly coreCount?: number;
}

export interface FixedNodeSummary {
    readonly id?: string;
    readonly name: string;
    readonly template?: string;
    readonly state?: string;
    readonly targetState?: string;
}

export interface ClusterDetailResult {
    readonly cluster: {
        readonly name: string;
        readonly state?: string;
        readonly targetState?: string;
        readonly nodeArrays: readonly NodeArraySummary[];
        readonly nodeArrayTotal: number;
        readonly nodeArrayReturned: number;
        readonly nodeArraysTruncated: boolean;
        readonly fixedNodes: readonly FixedNodeSummary[];
        readonly fixedNodeDefinitionsTotal: number;
        readonly fixedNodeDefinitionsReturned: number;
        readonly fixedNodeDefinitionsTruncated: boolean;
        readonly arrayNodeCount: number;
        readonly configuredNodeCount: number;
    };
}

export interface BucketStatus {
    readonly bucketId: string;
    readonly machineType?: string;
    readonly valid: boolean;
    readonly invalidReason?: string;
    readonly maxCount: number;
    readonly maxCoreCount: number;
    readonly quotaCount: number;
    readonly quotaCoreCount: number;
    readonly consumedCoreCount: number;
    readonly activeCount: number;
    readonly activeCoreCount: number;
    readonly availableCount: number;
    readonly availableCoreCount: number;
    readonly lastCapacityFailure?: number;
    readonly spotPlacementScore?: string;
}

export interface NodeArrayStatus {
    readonly name: string;
    readonly maxCount: number;
    readonly maxCoreCount: number;
    readonly buckets: readonly BucketStatus[];
    readonly bucketTotal: number;
    readonly bucketReturned: number;
    readonly bucketsTruncated: boolean;
}

export interface ClusterStatusResult {
    readonly status: {
        readonly clusterName: string;
        readonly state?: string;
        readonly targetState?: string;
        readonly maxCount: number;
        readonly maxCoreCount: number;
        readonly nodeArrays: readonly NodeArrayStatus[];
        readonly nodeArrayTotal: number;
        readonly nodeArrayReturned: number;
        readonly nodeArraysTruncated: boolean;
        readonly bucketTotal: number;
        readonly bucketReturned: number;
        readonly bucketsTruncated: boolean;
    };
}

export interface ClusterIssue {
    readonly name: string;
    readonly severity: "Error" | "Warning";
    readonly nodeCount: number;
    readonly message?: string;
    readonly detail?: string;
    readonly recommendation?: string;
    readonly textTruncated: boolean;
}

export interface ClusterIssues {
    readonly available: true;
    readonly items: readonly ClusterIssue[];
    readonly total: number;
    readonly returned: number;
    readonly truncated: boolean;
}

export type ClusterStatusWithIssues = {
    readonly status: ClusterStatusResult["status"] & {
        readonly issues:
            | ClusterIssues
            | {
                  readonly available: false;
                  readonly warning: string;
              };
    };
};

type ConsumedFields = ReadonlyMap<string, unknown>;

export function normalizeClusterIssues(
    raw: unknown,
    limit: number,
): ClusterIssues {
    validateLimit(limit, 0, 100);
    if (!Array.isArray(raw)) invalidResponse();
    const issues: ClusterIssue[] = [];
    for (const value of raw) {
        const fields = consumedFields(value, [
            "name",
            "status",
            "nodecount",
            "message",
            "detail",
            "recommendation",
        ]);
        const severity = requiredString(fields, "status", 128);
        if (severity === "OK" || severity === "Pending") continue;
        if (severity !== "Error" && severity !== "Warning") invalidResponse();
        let textTruncated = false;
        const text: Record<string, string> = {};
        for (const key of ["message", "detail", "recommendation"]) {
            const value = fields.get(key);
            if (value === undefined || value === null) continue;
            if (typeof value !== "string" || !isWellFormed(value))
                invalidResponse();
            const characters = [
                ...value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " "),
            ];
            textTruncated ||= characters.length > 2048;
            text[key] =
                characters.length > 2048
                    ? characters.slice(0, 2047).join("") + "…"
                    : characters.join("");
        }
        issues.push({
            name: requiredString(fields, "name", 256),
            severity,
            nodeCount: requiredNonNegativeInteger(
                requiredField(fields, "nodecount"),
            ),
            ...text,
            textTruncated,
        });
    }
    issues.sort(
        (left, right) =>
            compareNames(left.severity, right.severity) ||
            compareNames(left.name, right.name) ||
            compareNames(left.message ?? "", right.message ?? ""),
    );
    const items = issues.slice(0, limit);
    return {
        available: true,
        items,
        total: issues.length,
        returned: items.length,
        truncated: items.length < issues.length,
    };
}

export function normalizeClusterList(
    raw: unknown,
    limit: number,
): ClusterListResult {
    validateLimit(limit, 1, 200);
    if (!Array.isArray(raw)) invalidResponse();

    const clusters = raw
        .map(normalizeClusterSummary)
        .sort((left, right) => compareNames(left.name, right.name));
    const returned = clusters.slice(0, limit);
    return {
        clusters: returned,
        total: clusters.length,
        returned: returned.length,
        truncated: returned.length < clusters.length,
    };
}

export function normalizeCluster(
    raw: unknown,
    requestedName: string,
    fixedNodeLimit: number,
    nodeArrayLimit: number,
): ClusterDetailResult {
    validateLimit(fixedNodeLimit, 0, 200);
    validateLimit(nodeArrayLimit, 0, 100);
    if (!Array.isArray(raw)) invalidResponse();
    if (raw.length === 0)
        throw new CycleCloudRequestError("cluster_not_found", false);
    if (raw.length !== 1) invalidResponse();

    const fields = consumedFields(raw[0], [
        "clustername",
        "state",
        "targetstate",
        "nodes",
        "nodearrays",
    ]);
    const name = requiredString(fields, "clustername", 256);
    if (name !== requestedName) invalidResponse();

    const state = optionalString(fields, "state", 128);
    const targetState = optionalString(fields, "targetstate", 128);
    const fixedNodes = optionalArray(fields, "nodes")
        .map(normalizeFixedNode)
        .sort((left, right) => compareNames(left.name, right.name));
    const nodeArrays = optionalArray(fields, "nodearrays")
        .map(normalizeNodeArray)
        .sort((left, right) => compareNames(left.template, right.template));
    const arrayNodeCount = checkedSum(
        nodeArrays.map((nodeArray) => nodeArray.count),
    );
    const configuredNodeCount = checkedAdd(fixedNodes.length, arrayNodeCount);
    const returnedFixedNodes = fixedNodes.slice(0, fixedNodeLimit);
    const returnedNodeArrays = nodeArrays.slice(0, nodeArrayLimit);

    return {
        cluster: {
            name,
            ...optionalProperty("state", state),
            ...optionalProperty("targetState", targetState),
            nodeArrays: returnedNodeArrays,
            nodeArrayTotal: nodeArrays.length,
            nodeArrayReturned: returnedNodeArrays.length,
            nodeArraysTruncated: returnedNodeArrays.length < nodeArrays.length,
            fixedNodes: returnedFixedNodes,
            fixedNodeDefinitionsTotal: fixedNodes.length,
            fixedNodeDefinitionsReturned: returnedFixedNodes.length,
            fixedNodeDefinitionsTruncated:
                returnedFixedNodes.length < fixedNodes.length,
            arrayNodeCount,
            configuredNodeCount,
        },
    };
}

export function normalizeClusterStatus(
    raw: unknown,
    clusterName: string,
    nodeArrayLimit: number,
    bucketLimit: number,
): ClusterStatusResult {
    validateLimit(nodeArrayLimit, 0, 50);
    validateLimit(bucketLimit, 0, 50);
    const record = requiredRecord(raw);
    const state = optionalWireString(record.state, 128);
    const targetState = optionalWireString(record.targetState, 128);
    const maxCount = requiredNonNegativeInteger(record.maxCount);
    const maxCoreCount = requiredNonNegativeInteger(record.maxCoreCount);
    if (!Array.isArray(record.nodearrays)) invalidResponse();

    const nodeArrays = record.nodearrays
        .map(normalizeNodeArrayStatus)
        .sort((left, right) => compareNames(left.name, right.name));
    const bucketTotal = checkedSum(
        nodeArrays.map((nodeArray) => nodeArray.buckets.length),
    );
    const selectedNodeArrays = nodeArrays.slice(0, nodeArrayLimit);
    let remainingBucketBudget = 500;
    const returnedNodeArrays = selectedNodeArrays.map(
        (nodeArray): NodeArrayStatus => {
            const count = Math.min(
                nodeArray.buckets.length,
                bucketLimit,
                remainingBucketBudget,
            );
            const buckets = nodeArray.buckets.slice(0, count);
            remainingBucketBudget -= buckets.length;
            return {
                name: nodeArray.name,
                maxCount: nodeArray.maxCount,
                maxCoreCount: nodeArray.maxCoreCount,
                buckets,
                bucketTotal: nodeArray.buckets.length,
                bucketReturned: buckets.length,
                bucketsTruncated: buckets.length < nodeArray.buckets.length,
            };
        },
    );
    const bucketReturned = checkedSum(
        returnedNodeArrays.map((nodeArray) => nodeArray.bucketReturned),
    );

    return {
        status: {
            clusterName,
            ...optionalProperty("state", state),
            ...optionalProperty("targetState", targetState),
            maxCount,
            maxCoreCount,
            nodeArrays: returnedNodeArrays,
            nodeArrayTotal: nodeArrays.length,
            nodeArrayReturned: returnedNodeArrays.length,
            nodeArraysTruncated: returnedNodeArrays.length < nodeArrays.length,
            bucketTotal,
            bucketReturned,
            bucketsTruncated: bucketReturned < bucketTotal,
        },
    };
}

function normalizeClusterSummary(value: unknown): ClusterSummary {
    const fields = consumedFields(value, [
        "clustername",
        "state",
        "targetstate",
        "nodes",
        "nodearrays",
    ]);
    const name = requiredString(fields, "clustername", 256);
    const state = optionalString(fields, "state", 128);
    const targetState = optionalString(fields, "targetstate", 128);
    const fixedNodes = optionalArray(fields, "nodes");
    const nodeArrays = optionalArray(fields, "nodearrays");
    const arrayNodeCount = checkedSum(
        nodeArrays.map((nodeArray) =>
            requiredNonNegativeInteger(
                requiredField(consumedFields(nodeArray, ["count"]), "count"),
            ),
        ),
    );
    return {
        name,
        ...optionalProperty("state", state),
        ...optionalProperty("targetState", targetState),
        fixedNodeDefinitions: fixedNodes.length,
        nodeArrayCount: nodeArrays.length,
        arrayNodeCount,
        configuredNodeCount: checkedAdd(fixedNodes.length, arrayNodeCount),
    };
}

function normalizeFixedNode(value: unknown): FixedNodeSummary {
    const fields = consumedFields(value, [
        "nodeid",
        "name",
        "template",
        "state",
        "targetstate",
    ]);
    const id = optionalString(fields, "nodeid", 256);
    const name = requiredString(fields, "name", 256);
    const template = optionalString(fields, "template", 256);
    const state = optionalString(fields, "state", 128);
    const targetState = optionalString(fields, "targetstate", 128);
    return {
        ...optionalProperty("id", id),
        name,
        ...optionalProperty("template", template),
        ...optionalProperty("state", state),
        ...optionalProperty("targetState", targetState),
    };
}

function normalizeNodeArray(value: unknown): NodeArraySummary {
    const fields = consumedFields(value, [
        "template",
        "state",
        "targetstate",
        "count",
        "corecount",
    ]);
    const template = requiredString(fields, "template", 256);
    const state = optionalString(fields, "state", 128);
    const targetState = optionalString(fields, "targetstate", 128);
    const count = requiredNonNegativeInteger(requiredField(fields, "count"));
    const coreCountValue = fields.get("corecount");
    const coreCount =
        coreCountValue === undefined
            ? undefined
            : requiredNonNegativeInteger(coreCountValue);
    return {
        template,
        ...optionalProperty("state", state),
        ...optionalProperty("targetState", targetState),
        count,
        ...optionalProperty("coreCount", coreCount),
    };
}

function normalizeNodeArrayStatus(
    value: unknown,
): Omit<
    NodeArrayStatus,
    "bucketTotal" | "bucketReturned" | "bucketsTruncated"
> {
    const record = requiredRecord(value);
    if (!Array.isArray(record.buckets)) invalidResponse();
    return {
        name: requiredWireString(record.name, 256),
        maxCount: requiredNonNegativeInteger(record.maxCount),
        maxCoreCount: requiredNonNegativeInteger(record.maxCoreCount),
        buckets: record.buckets
            .map(normalizeBucketStatus)
            .sort((left, right) => compareNames(left.bucketId, right.bucketId)),
    };
}

function normalizeBucketStatus(value: unknown): BucketStatus {
    const record = requiredRecord(value);
    const definition =
        record.definition === undefined
            ? undefined
            : requiredRecord(record.definition);
    const machineType =
        definition === undefined
            ? undefined
            : optionalWireString(definition.machineType, 256);
    const invalidReason = optionalWireString(record.invalidReason, 256);
    const lastCapacityFailure = optionalFiniteNumber(
        record.lastCapacityFailure,
    );
    const spotPlacementScore = optionalWireString(
        record.spotPlacementScore,
        256,
    );
    if (typeof record.valid !== "boolean") invalidResponse();
    return {
        bucketId: requiredWireString(record.bucketId, 256),
        ...optionalProperty("machineType", machineType),
        valid: record.valid,
        ...optionalProperty("invalidReason", invalidReason),
        maxCount: requiredNonNegativeInteger(record.maxCount),
        maxCoreCount: requiredNonNegativeInteger(record.maxCoreCount),
        quotaCount: requiredNonNegativeInteger(record.quotaCount),
        quotaCoreCount: requiredNonNegativeInteger(record.quotaCoreCount),
        consumedCoreCount: requiredNonNegativeInteger(record.consumedCoreCount),
        activeCount: requiredNonNegativeInteger(record.activeCount),
        activeCoreCount: requiredNonNegativeInteger(record.activeCoreCount),
        availableCount: requiredNonNegativeInteger(record.availableCount),
        availableCoreCount: requiredNonNegativeInteger(
            record.availableCoreCount,
        ),
        ...optionalProperty("lastCapacityFailure", lastCapacityFailure),
        ...optionalProperty("spotPlacementScore", spotPlacementScore),
    };
}

export function consumedFields(
    value: unknown,
    consumedNames: readonly string[],
): ConsumedFields {
    const record = requiredRecord(value);
    const allowed = new Set(consumedNames);
    const result = new Map<string, unknown>();
    for (const [key, fieldValue] of Object.entries(record)) {
        const normalizedKey = asciiLowercase(key);
        if (!allowed.has(normalizedKey)) continue;
        if (result.has(normalizedKey)) invalidResponse();
        result.set(normalizedKey, fieldValue);
    }
    return result;
}

export function requiredRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) invalidResponse();
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredField(fields: ConsumedFields, name: string): unknown {
    if (!fields.has(name)) invalidResponse();
    return fields.get(name);
}

function optionalArray(
    fields: ConsumedFields,
    name: string,
): readonly unknown[] {
    const value = fields.get(name);
    if (value === undefined) return [];
    if (!Array.isArray(value)) invalidResponse();
    return value;
}

function requiredString(
    fields: ConsumedFields,
    name: string,
    maximumScalars: number,
): string {
    return requiredWireString(requiredField(fields, name), maximumScalars);
}

function optionalString(
    fields: ConsumedFields,
    name: string,
    maximumScalars: number,
): string | undefined {
    return optionalWireString(fields.get(name), maximumScalars);
}

export function requiredWireString(
    value: unknown,
    maximumScalars: number,
): string {
    const result = optionalWireString(value, maximumScalars);
    if (result === undefined || result.length === 0) invalidResponse();
    return result;
}

function optionalWireString(
    value: unknown,
    maximumScalars: number,
): string | undefined {
    if (value === undefined) return undefined;
    if (
        typeof value !== "string" ||
        !isWellFormed(value) ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ) {
        invalidResponse();
    }
    if ([...value].length > maximumScalars) invalidResponse();
    return value;
}

function requiredNonNegativeInteger(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        invalidResponse();
    return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse();
    return value;
}

function checkedSum(values: readonly number[]): number {
    return values.reduce(checkedAdd, 0);
}

function checkedAdd(left: number, right: number): number {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0) invalidResponse();
    return result;
}

function validateLimit(value: number, minimum: number, maximum: number): void {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
        invalidResponse();
}

export function compareNames(left: string, right: string): number {
    const foldedLeft = asciiLowercase(left);
    const foldedRight = asciiLowercase(right);
    if (foldedLeft < foldedRight) return -1;
    if (foldedLeft > foldedRight) return 1;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function asciiLowercase(value: string): string {
    return value.replace(/[A-Z]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) + 32),
    );
}

function isWellFormed(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return false;
        }
    }
    return true;
}

function optionalProperty<Value>(
    key: string,
    value: Value | undefined,
): Record<string, Value> {
    return value === undefined ? {} : { [key]: value };
}

function invalidResponse(): never {
    throw new CycleCloudRequestError("invalid_response", false);
}
