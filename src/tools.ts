import type {
    ActionDispatchResult,
    CycleCloudClient,
} from "./cyclecloud-client.js";
import { CycleCloudRequestError } from "./errors.js";
import type {
    ApplicationContextInput,
    ApplicationContextResult,
} from "./application-context.js";
import { readApplicationContext } from "./application-context-reader.js";
import {
    normalizeCluster,
    normalizeClusterList,
    normalizeClusterStatus,
    normalizeClusterIssues,
    type ClusterDetailResult,
    type ClusterListResult,
    type ClusterStatusWithIssues,
} from "./normalize.js";

export const unknownOutcomeWarning =
    "The CycleCloud action may have partially completed. Inspect the cluster status before retrying.";
export const followUpWarning =
    "The CycleCloud action was accepted, but the follow-up status read did not complete.";

export interface ListClustersInput {
    readonly limit: number;
}

export interface GetClusterInput {
    readonly clusterName: string;
    readonly fixedNodeLimit: number;
    readonly nodeArrayLimit: number;
}

export interface GetClusterStatusInput {
    readonly clusterName: string;
    readonly nodeArrayLimit: number;
    readonly bucketLimit: number;
    readonly issueLimit?: number;
}

export interface MutationInput {
    readonly clusterName: string;
    readonly recursive: boolean;
}

export interface MutationResult {
    readonly action: "start" | "terminate";
    readonly clusterName: string;
    readonly recursive: boolean;
    readonly outcome: "accepted" | "unknown";
    readonly observedStatus?: {
        readonly state?: string;
        readonly targetState?: string;
    };
    readonly warning?: string;
}

export class CycleCloudTools {
    readonly #client: CycleCloudClient;
    #mutationInProgress = false;

    constructor(client: CycleCloudClient) {
        this.#client = client;
    }

    async listClusters(
        input: ListClustersInput,
        signal: AbortSignal,
    ): Promise<ClusterListResult> {
        return normalizeClusterList(
            await this.#client.listClusters({ signal }),
            input.limit,
        );
    }

    async getCluster(
        input: GetClusterInput,
        signal: AbortSignal,
    ): Promise<ClusterDetailResult> {
        return normalizeCluster(
            await this.#client.getCluster(input.clusterName, { signal }),
            input.clusterName,
            input.fixedNodeLimit,
            input.nodeArrayLimit,
        );
    }

    async getClusterStatus(
        input: GetClusterStatusInput,
        signal: AbortSignal,
    ): Promise<ClusterStatusWithIssues> {
        const result = normalizeClusterStatus(
            await this.#client.getClusterStatus(input.clusterName, { signal }),
            input.clusterName,
            input.nodeArrayLimit,
            input.bucketLimit,
        );
        let issues: ClusterStatusWithIssues["status"]["issues"];
        try {
            issues = normalizeClusterIssues(
                await this.#client.getClusterIssues(input.clusterName, {
                    signal,
                }),
                input.issueLimit ?? 20,
            );
        } catch (error: unknown) {
            if (
                signal.aborted ||
                (error instanceof CycleCloudRequestError &&
                    error.category === "cancelled")
            ) {
                throw new CycleCloudRequestError("cancelled", false);
            }
            issues = {
                available: false,
                warning:
                    "Cluster status is available, but node issues could not be retrieved.",
            };
        }
        return { status: { ...result.status, issues } };
    }

    async getClusterApplicationContext(
        input: ApplicationContextInput,
        signal: AbortSignal,
    ): Promise<ApplicationContextResult> {
        return readApplicationContext(this.#client, input, signal);
    }

    async startCluster(
        input: MutationInput,
        signal: AbortSignal,
    ): Promise<MutationResult> {
        return this.#mutate("start", input, signal);
    }

    async terminateCluster(
        input: MutationInput,
        signal: AbortSignal,
    ): Promise<MutationResult> {
        return this.#mutate("terminate", input, signal);
    }

    async #mutate(
        action: "start" | "terminate",
        input: MutationInput,
        signal: AbortSignal,
    ): Promise<MutationResult> {
        if (signal.aborted)
            throw new CycleCloudRequestError("cancelled", false);
        if (this.#mutationInProgress)
            throw new CycleCloudRequestError("busy", true);
        this.#mutationInProgress = true;
        try {
            const dispatch = await this.#dispatch(action, input, signal);
            if (dispatch.outcome === "unknown") {
                return {
                    action,
                    ...input,
                    outcome: "unknown",
                    warning: unknownOutcomeWarning,
                };
            }

            try {
                const rawStatus = await this.#client.getClusterStatus(
                    input.clusterName,
                    { signal },
                );
                const status = normalizeClusterStatus(
                    rawStatus,
                    input.clusterName,
                    0,
                    0,
                ).status;
                const hasObservedStatus =
                    status.state !== undefined ||
                    status.targetState !== undefined;
                return {
                    action,
                    ...input,
                    outcome: "accepted",
                    ...(hasObservedStatus
                        ? {
                              observedStatus: {
                                  ...(status.state === undefined
                                      ? {}
                                      : { state: status.state }),
                                  ...(status.targetState === undefined
                                      ? {}
                                      : { targetState: status.targetState }),
                              },
                          }
                        : {}),
                };
            } catch {
                return {
                    action,
                    ...input,
                    outcome: "accepted",
                    warning: followUpWarning,
                };
            }
        } finally {
            this.#mutationInProgress = false;
        }
    }

    async #dispatch(
        action: "start" | "terminate",
        input: MutationInput,
        signal: AbortSignal,
    ): Promise<ActionDispatchResult> {
        return action === "start"
            ? this.#client.startCluster(input.clusterName, input.recursive, {
                  signal,
              })
            : this.#client.terminateCluster(
                  input.clusterName,
                  input.recursive,
                  { signal },
              );
    }
}
