import type { ActionDispatchResult, CycleCloudClient, CycleCloudRequestOptions } from "../../src/cyclecloud-client.js";

export type ActionHandler = (clusterName: string, recursive: boolean, options: CycleCloudRequestOptions) => Promise<ActionDispatchResult>;

export class FakeCycleCloudClient implements CycleCloudClient {
  listResult: unknown = [];
  clusterResult: unknown = [];
  statusResult: unknown = { nodearrays: [], maxCount: 0, maxCoreCount: 0 };
  startResult: ActionDispatchResult = { outcome: "accepted" };
  terminateResult: ActionDispatchResult = { outcome: "accepted" };
  startHandler: ActionHandler | undefined;
  terminateHandler: ActionHandler | undefined;
  readonly calls = {
    list: 0,
    cluster: 0,
    status: 0,
    start: 0,
    terminate: 0,
    close: 0,
  };

  listClusters(): Promise<unknown> {
    this.calls.list += 1;
    return Promise.resolve(this.listResult);
  }

  getCluster(): Promise<unknown> {
    this.calls.cluster += 1;
    return Promise.resolve(this.clusterResult);
  }

  getClusterStatus(): Promise<unknown> {
    this.calls.status += 1;
    return Promise.resolve(this.statusResult);
  }

  startCluster(clusterName: string, recursive: boolean, options: CycleCloudRequestOptions = {}): Promise<ActionDispatchResult> {
    this.calls.start += 1;
    return this.startHandler === undefined ? Promise.resolve(this.startResult) : this.startHandler(clusterName, recursive, options);
  }

  terminateCluster(clusterName: string, recursive: boolean, options: CycleCloudRequestOptions = {}): Promise<ActionDispatchResult> {
    this.calls.terminate += 1;
    return this.terminateHandler === undefined
      ? Promise.resolve(this.terminateResult)
      : this.terminateHandler(clusterName, recursive, options);
  }

  close(): Promise<void> {
    this.calls.close += 1;
    return Promise.resolve();
  }
}
