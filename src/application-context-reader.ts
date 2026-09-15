import type { CycleCloudClient } from "./cyclecloud-client.js";
import { CycleCloudRequestError } from "./errors.js";
import { normalizeImagePlatform } from "./image-platform.js";
import {
    boundedList,
    normalizeApplicationDetails,
    normalizeApplicationOverview,
    normalizeApplicationParameters,
    normalizeContextCluster,
    unavailable,
    type ApplicationContextInput,
    type ApplicationContextResult,
    type EvidenceList,
} from "./application-context.js";

function checkCancellation(signal: AbortSignal, error?: unknown): void {
    if (
        signal.aborted ||
        (error instanceof CycleCloudRequestError &&
            error.category === "cancelled")
    )
        throw new CycleCloudRequestError("cancelled", false);
}

export async function readApplicationContext(
    client: CycleCloudClient,
    input: ApplicationContextInput,
    signal: AbortSignal,
): Promise<ApplicationContextResult> {
    checkCancellation(signal);
    const view = input.view ?? "overview";
    const section = input.section ?? "environment";
    const targetName = input.targetNames?.[0];
    if (
        view === "details" &&
        (input.targetNames?.length !== 1 || targetName === undefined)
    )
        throw new CycleCloudRequestError("invalid_response", false);
    const cluster = normalizeContextCluster(
        await client.getCluster(input.clusterName, { signal }),
        input.clusterName,
    );
    const context: ApplicationContextResult["context"] = {
        clusterName: cluster.name,
        ...(cluster.state === undefined ? {} : { state: cluster.state }),
        ...(cluster.targetState === undefined
            ? {}
            : { targetState: cluster.targetState }),
        observedAt: new Date().toISOString(),
        evidence: "configured",
        view,
        ...(view === "details" ? { section } : {}),
        installPath: input.installPath,
        sources: [
            "CycleCloud cluster summary",
            `Cloud.Node ${view === "overview" ? "overview" : section}`,
        ],
        targets: unavailable(
            "Application node configuration could not be retrieved or validated.",
        ),
        nextStep:
            view === "overview"
                ? "Choose a target, then request view=details with one targetNames entry and section=environment, storage, or attachments. Page only when needed using nextOffset."
                : "Follow a collection's nextOffset only if more entries are needed, using the same target, section and itemLimit. Other sections require separate calls.",
        warnings: [
            "Configuration is not an atomic snapshot. Re-read before changes.",
            "Shared or inherited parameters may affect other targets or child clusters.",
        ],
        unverified: [
            "Installed application software, compiler, MPI and node-local libraries.",
            "Actual OS/architecture, mounted/writable storage and rollout data survival.",
            "Live Slurm accounts, QoS, jobs and MPI launcher compatibility.",
            "Uploaded artifacts, successful spec execution and application readiness.",
        ],
    };
    if (view === "overview") {
        try {
            const nodes = normalizeApplicationOverview(
                await client.getApplicationNodes(
                    input.clusterName,
                    { signal },
                    { view: "overview" },
                ),
            );
            checkCancellation(signal);
            const selected = nodes.filter(
                (node) =>
                    input.targetNames === undefined ||
                    input.targetNames.includes(node.name),
            );
            context.targets = {
                ...boundedList(selected, input.targetLimit, input.offset),
                missingRequested: (input.targetNames ?? []).filter(
                    (name) => !nodes.some((node) => node.name === name),
                ),
            };
        } catch (error) {
            checkCancellation(signal, error);
        }
        return { context };
    }
    if (targetName === undefined)
        throw new CycleCloudRequestError("invalid_response", false);
    const page = { limit: input.itemLimit ?? 5, offset: input.offset ?? 0 };
    let target;
    try {
        const nodes = normalizeApplicationDetails(
            await client.getApplicationNodes(
                input.clusterName,
                { signal },
                { view: "details", targetName, section },
            ),
            input.installPath,
            section,
            page,
        );
        if (nodes.length > 1 || nodes.some((node) => node.name !== targetName))
            throw new CycleCloudRequestError("invalid_response", false);
        checkCancellation(signal);
        context.targets = {
            ...boundedList(nodes, 1, 0, 24576),
            missingRequested: nodes.length ? [] : [targetName],
        };
        target = nodes[0];
    } catch (error) {
        checkCancellation(signal, error);
        return { context };
    }
    if (
        section === "environment" &&
        target !== undefined &&
        "platform" in target
    ) {
        context.nextStep +=
            " Use supplied platform and scheduler.version as the configured authoring baseline; ask only about missing/conflicting facts or application choices. Runtime checks are a separate follow-up.";
        if (target.image !== undefined) {
            context.sources.push("CycleCloud Package image metadata");
            try {
                const platform = normalizeImagePlatform(
                    await client.getImageMetadata(target.image, { signal }),
                    target.image,
                );
                checkCancellation(signal);
                // Keep optional enrichment within the existing single-target envelope budget.
                if (
                    Buffer.byteLength(JSON.stringify({ ...target, platform })) >
                    24576
                )
                    throw new CycleCloudRequestError("invalid_response", false);
                target.platform = platform;
            } catch (error) {
                checkCancellation(signal, error);
            }
        }
        return { context };
    }
    if (section !== "attachments" || target === undefined) return { context };
    context.attachmentParameters = unavailable(
        "Attachment parameter metadata could not be retrieved or validated.",
    );
    if (!("attachment" in target) || !target.attachment.available) {
        context.attachmentParameters = unavailable(
            "No simple attachment parameter is available. Inspect the template before attaching.",
        );
        return { context };
    }
    const parameterName = target.attachment.parameterName;
    let usedBy: EvidenceList<string> = unavailable(
        "Shared parameter uses could not be retrieved; do not assume this is a single-target edit.",
    );
    try {
        const overview = normalizeApplicationOverview(
            await client.getApplicationNodes(
                input.clusterName,
                { signal },
                { view: "overview" },
            ),
        );
        checkCancellation(signal);
        usedBy = overview.some((node) => node.attachmentParameter === undefined)
            ? unavailable(
                  "Some target attachment references are missing or are not simple parameter references. Shared-use coverage is incomplete; inspect the template before assuming a single-target edit.",
              )
            : boundedList(
                  overview
                      .filter(
                          (node) =>
                              node.attachmentParameter?.toLowerCase() ===
                              parameterName.toLowerCase(),
                      )
                      .map((node) => node.name),
                  page.limit,
                  page.offset,
              );
    } catch (error) {
        checkCancellation(signal, error);
    }
    try {
        let root = cluster;
        const visited = new Set([root.name.toLowerCase()]);
        while (root.parentName !== undefined) {
            if (
                visited.size >= 10 ||
                visited.has(root.parentName.toLowerCase())
            )
                throw new CycleCloudRequestError("invalid_response", false);
            checkCancellation(signal);
            const parentName = root.parentName;
            root = normalizeContextCluster(
                await client.getCluster(parentName, { signal }),
                parentName,
            );
            visited.add(root.name.toLowerCase());
        }
        context.sources.push("Cloud.ClusterParameter cluster-init metadata");
        const parameters = normalizeApplicationParameters(
            await client.getApplicationParameters(
                root.name,
                { signal },
                parameterName,
            ),
            page,
        );
        checkCancellation(signal);
        const relevant = parameters
            .filter(
                (parameter) =>
                    parameter.name.toLowerCase() ===
                    parameterName.toLowerCase(),
            )
            .map((parameter) => ({ ...parameter, usedBy }));
        context.attachmentParameters = {
            ...boundedList(relevant, 1, 0, 24576),
            clusterName: root.name,
            missingReferenced: relevant.length ? [] : [parameterName],
        };
    } catch (error) {
        checkCancellation(signal, error);
    }
    return { context };
}
