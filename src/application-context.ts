import { posix } from "node:path";
import { CycleCloudRequestError } from "./errors.js";
import type { ImagePlatform } from "./image-platform.js";
import {
    compareNames,
    consumedFields,
    requiredRecord,
    requiredWireString,
} from "./normalize.js";

export type ApplicationContextSection =
    | "environment"
    | "storage"
    | "attachments";
export type ApplicationReadSelection =
    | { view: "overview" }
    | {
          view: "details";
          targetName: string;
          section: ApplicationContextSection;
      };
export interface ContextPage {
    readonly offset?: number;
    readonly limit?: number;
}
export interface ApplicationContextInput {
    readonly clusterName: string;
    readonly targetNames?: readonly string[];
    readonly installPath: string;
    readonly targetLimit: number;
    readonly view?: "overview" | "details";
    readonly section?: ApplicationContextSection;
    readonly offset?: number;
    readonly itemLimit?: number;
}

export type Unavailable = { available: false; warning: string };
export interface AvailableList<T> {
    available: true;
    items: T[];
    total: number;
    returned: number;
    truncated: boolean;
    offset: number;
    nextOffset: number | null;
}
export type EvidenceList<T> = AvailableList<T> | Unavailable;
type Fields = ReadonlyMap<string, unknown>;

export function unavailable(warning: string): Unavailable {
    return { available: false, warning };
}

export function boundedList<T>(
    items: readonly T[],
    limit = 20,
    offset = 0,
    byteLimit = 6144,
): AvailableList<T> {
    const page: T[] = [];
    let bytes = 2;
    for (const item of items.slice(offset, offset + limit)) {
        const size = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
        if (bytes + size > byteLimit) {
            if (!page.length) invalid();
            break;
        }
        page.push(item);
        bytes += size;
    }
    return {
        available: true,
        items: page,
        total: items.length,
        returned: page.length,
        truncated: items.length > page.length,
        offset,
        nextOffset:
            offset + page.length < items.length ? offset + page.length : null,
    };
}

function invalid(): never {
    throw new CycleCloudRequestError("invalid_response", false);
}
function text(value: unknown): string | undefined {
    return value == null || value === ""
        ? undefined
        : requiredWireString(value, 256);
}
function flag(value: unknown): boolean | undefined {
    if (value == null) return undefined;
    if (typeof value !== "boolean") invalid();
    return value;
}
function integer(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid();
    return value;
}
function identifier(value: unknown): string | undefined {
    const result = text(value);
    // These fields identify configured resources, not credential-bearing URLs.
    if (result !== undefined && /:\/\/|[?#]/u.test(result)) invalid();
    return result;
}
function rows(value: unknown): unknown[] {
    if (!Array.isArray(value)) invalid();
    return value;
}
function unique<T>(items: T[], name: (item: T) => string): T[] {
    const keys = items.map(name).map((key) => key.toLowerCase());
    if (new Set(keys).size !== keys.length) invalid();
    return items.sort((left, right) => compareNames(name(left), name(right)));
}
function recordList<T>(
    value: unknown,
    normalize: (name: string, fields: unknown) => T,
    page: ContextPage = {},
): EvidenceList<T> {
    if (value == null)
        return unavailable(
            "This configuration collection was not supplied by CycleCloud.",
        );
    const entries = Object.entries(requiredRecord(value));
    for (const [name] of entries) requiredWireString(name, 256);
    const items = unique(entries, ([name]) => name).map(([name, fields]) =>
        normalize(name, fields),
    );
    return boundedList(items, page.limit, page.offset);
}

export function isInstallPath(value: string): boolean {
    try {
        requiredWireString(value, 1024);
    } catch {
        return false;
    }
    return (
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.split("/").some((part) => part === "." || part === "..")
    );
}

function stringList(
    value: unknown,
    page: ContextPage = {},
): EvidenceList<string> {
    if (value == null)
        return unavailable(
            "This configuration field was not supplied by CycleCloud.",
        );
    const items = typeof value === "string" ? [value] : rows(value);
    const strings = items.map((item) => requiredWireString(item, 256));
    if (
        new Set(strings.map((item) => item.toLowerCase())).size !==
        strings.length
    )
        invalid();
    // Inheritance precedence and VM preference order are configuration evidence.
    return boundedList(strings, page.limit, page.offset);
}

function normalizeSpecs(value: unknown, page: ContextPage = {}) {
    return recordList(
        value,
        (_name, raw) => {
            const f = consumedFields(raw, [
                "project",
                "spec",
                "version",
                "sourcelocker",
                "additionalspec",
                "order",
            ]);
            return {
                project: requiredWireString(f.get("project"), 256),
                spec: requiredWireString(f.get("spec"), 256),
                version: identifier(f.get("version")),
                sourceLocker: identifier(f.get("sourcelocker")),
                additional: flag(f.get("additionalspec")),
                order: integer(f.get("order")),
            };
        },
        page,
    );
}

function normalizeMounts(
    value: unknown,
    installPath: string,
    page: ContextPage = {},
) {
    return recordList(
        value,
        (name, raw) => {
            const f = consumedFields(raw, [
                "mountpoint",
                "type",
                "fs_type",
                "disabled",
            ]);
            const mountpoint = text(f.get("mountpoint"));
            if (mountpoint !== undefined && !isInstallPath(mountpoint))
                invalid();
            const disabled = flag(f.get("disabled"));
            const prefix =
                mountpoint === undefined
                    ? undefined
                    : posix.normalize(mountpoint).replace(/\/$/u, "");
            const within =
                prefix !== undefined &&
                (installPath === prefix ||
                    installPath.startsWith(`${prefix}/`));
            return {
                name,
                mountpoint,
                type: text(f.get("type")),
                filesystem: text(f.get("fs_type")),
                disabled,
                coversInstallPath:
                    disabled === true || (prefix !== undefined && !within)
                        ? false
                        : disabled === false && prefix !== undefined
                          ? within
                          : null,
            };
        },
        page,
    );
}

function normalizeVolumes(value: unknown, page: ContextPage = {}) {
    return recordList(
        value,
        (name, raw) => {
            const f = consumedFields(raw, ["mount", "persistent", "disabled"]);
            return {
                name,
                mount: text(f.get("mount")),
                persistent: flag(f.get("persistent")),
                disabled: flag(f.get("disabled")),
            };
        },
        page,
    );
}

function normalizeAttachment(
    value: unknown,
): { available: true; parameterName: string } | Unavailable {
    if (typeof value !== "string")
        return unavailable(
            "No simple additional-spec parameter reference is available; inspect the cluster template before attaching.",
        );
    const match =
        /^\$(?:([A-Za-z_][A-Za-z0-9_.-]{0,255})|\{([A-Za-z_][A-Za-z0-9_.-]{0,255})\})$/u.exec(
            value,
        );
    const name = match?.[1] ?? match?.[2];
    return name === undefined
        ? unavailable(
              "The attachment reference is not a simple parameter; inspect the cluster template before attaching.",
          )
        : { available: true, parameterName: name };
}

function normalizeIdentity(f: Fields) {
    const name = requiredWireString(f.get("name"), 256);
    const array = flag(f.get("isarray"));
    if (array !== true && text(f.get("template")) !== name) invalid();
    return {
        name,
        kind: array === true ? ("nodearray" as const) : ("node" as const),
    };
}

export function normalizeApplicationOverview(value: unknown) {
    return unique(
        rows(value).map((raw) => {
            const f = consumedFields(raw, [
                "name",
                "template",
                "isarray",
                "state",
                "imagename",
                "slurmrole",
                "slurmpartition",
                "slurmhaenabled",
                "attachmentreference",
            ]);
            const identity = normalizeIdentity(f);
            const attachment = normalizeAttachment(
                f.get("attachmentreference"),
            );
            return {
                ...identity,
                state: text(f.get("state")),
                image: identifier(f.get("imagename")),
                role: text(f.get("slurmrole")),
                partition: text(f.get("slurmpartition")),
                haEnabled: flag(f.get("slurmhaenabled")),
                attachmentParameter: attachment.available
                    ? attachment.parameterName
                    : undefined,
            };
        }),
        (node) => node.name,
    );
}

export function normalizeApplicationDetails(
    value: unknown,
    installPath: string,
    section: ApplicationContextSection,
    page: ContextPage,
) {
    const sectionFields = {
        environment: [
            "extends",
            "state",
            "targetstate",
            "imagename",
            "machinetype",
            "architecture",
            "locker",
            "slurmrole",
            "slurmversion",
            "slurmpartition",
            "slurmhaenabled",
            "slurmprimaryscheduler",
            "slurmautoscale",
        ],
        storage: ["mounts", "volumes"],
        attachments: ["clusterinitspecs", "attachmentreference"],
    };
    return unique(
        rows(value).map((raw) => {
            const f = consumedFields(raw, [
                "name",
                "template",
                "isarray",
                ...sectionFields[section],
            ]);
            const identity = normalizeIdentity(f);
            if (section === "storage")
                return {
                    ...identity,
                    mounts: normalizeMounts(f.get("mounts"), installPath, page),
                    volumes: normalizeVolumes(f.get("volumes"), page),
                };
            if (section === "attachments")
                return {
                    ...identity,
                    specs: normalizeSpecs(f.get("clusterinitspecs"), page),
                    attachment: normalizeAttachment(
                        f.get("attachmentreference"),
                    ),
                };
            const image = identifier(f.get("imagename"));
            return {
                ...identity,
                state: text(f.get("state")),
                targetState: text(f.get("targetstate")),
                bases: stringList(f.get("extends"), page),
                image,
                platform: unavailable(
                    image === undefined
                        ? "The configured image was not supplied; its OS release is unresolved."
                        : "Image platform metadata could not be retrieved or validated.",
                ) as ImagePlatform,
                machineTypes: stringList(f.get("machinetype"), page),
                architecture: text(f.get("architecture")),
                locker: identifier(f.get("locker")),
                scheduler: {
                    role: text(f.get("slurmrole")),
                    version: text(f.get("slurmversion")),
                    partition: text(f.get("slurmpartition")),
                    haEnabled: flag(f.get("slurmhaenabled")),
                    primary: flag(f.get("slurmprimaryscheduler")),
                    autoscale: flag(f.get("slurmautoscale")),
                },
            };
        }),
        (node) => node.name,
    );
}

export type ApplicationOverview = ReturnType<
    typeof normalizeApplicationOverview
>[number];
export type ApplicationDetail = ReturnType<
    typeof normalizeApplicationDetails
>[number];

export function normalizeApplicationParameters(
    value: unknown,
    page: ContextPage = {},
) {
    return unique(
        rows(value).map((raw) => {
            const f = consumedFields(raw, [
                "name",
                "label",
                "parametertype",
                "value",
            ]);
            if (f.get("parametertype") !== "Cloud.ClusterInitSpecs") invalid();
            return {
                name: requiredWireString(f.get("name"), 256),
                label: text(f.get("label")),
                specs: normalizeSpecs(f.get("value"), page),
            };
        }),
        (parameter) => parameter.name,
    );
}

export function normalizeContextCluster(value: unknown, name: string) {
    const items = rows(value);
    if (!items.length)
        throw new CycleCloudRequestError("cluster_not_found", false);
    if (items.length !== 1) invalid();
    const f: Fields = consumedFields(items[0], [
        "clustername",
        "parentname",
        "state",
        "targetstate",
    ]);
    if (requiredWireString(f.get("clustername"), 256) !== name) invalid();
    return {
        name,
        parentName: text(f.get("parentname")),
        state: text(f.get("state")),
        targetState: text(f.get("targetstate")),
    };
}

export type ApplicationParameter = ReturnType<
    typeof normalizeApplicationParameters
>[number];
export interface ScopedParameter extends ApplicationParameter {
    usedBy: EvidenceList<string>;
}
export interface ApplicationContextResult {
    context: {
        clusterName: string;
        state?: string;
        targetState?: string;
        observedAt: string;
        evidence: "configured";
        view: "overview" | "details";
        section?: ApplicationContextSection;
        nextStep: string;
        installPath: string;
        sources: string[];
        targets:
            | (AvailableList<ApplicationOverview | ApplicationDetail> & {
                  missingRequested: string[];
              })
            | Unavailable;
        attachmentParameters?:
            | (AvailableList<ScopedParameter> & {
                  clusterName: string;
                  missingReferenced: string[];
              })
            | Unavailable;
        warnings: string[];
        unverified: string[];
    };
}
