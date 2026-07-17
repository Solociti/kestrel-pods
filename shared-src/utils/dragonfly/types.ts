import type { LifecycleState } from "../kubectl/types";

export const warmAvailableKey = "warm:available";
export const warmClaimingKey = "warm:claiming";

export interface DragonflyRetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
}

export interface DragonflyPodPayload {
  deploymentId: string;
  podServiceName: string;
  namespace: string;
  podHostName: string;
  "api-endpoint"?: string;
}

export interface DragonflyPodRecord extends DragonflyPodPayload {
  state: LifecycleState;
}

export interface ClaimedWarmPod {
  rawPayload: string;
  payload: DragonflyPodPayload;
}

export interface HotSelectionResult {
  podId: string;
  record: DragonflyPodRecord;
}

export interface DragonflyAdapterOptions {
  retryPolicy?: DragonflyRetryPolicy;
}

export interface HotSelectionOptions {
  maxSelectionAttempts?: number;
  evictInvalidPodIds?: boolean;
}

export interface DragonflyClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  lMove(
    source: string,
    destination: string,
    whereFrom: "LEFT" | "RIGHT",
    whereTo: "LEFT" | "RIGHT",
  ): Promise<string | null>;
  blMove(
    source: string,
    destination: string,
    whereFrom: "LEFT" | "RIGHT",
    whereTo: "LEFT" | "RIGHT",
    timeoutSeconds: number,
  ): Promise<string | null>;
  rPush(key: string, ...elements: string[]): Promise<number>;
  lRem(key: string, count: number, element: string): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
}
