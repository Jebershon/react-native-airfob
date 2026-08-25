declare module "react-native-airfob" {
  export type LogLevel = "off" | "error" | "warn" | "info" | "debug";
  export type LogSource = "sdk" | "ble" | "perm" | "service" | "bridge" | "licence";
  export type CheckState = "pass" | "fail" | "warn" | "unknown";
  export type UnlockResult = "opened" | "noReader" | "denied" | "error";
  export type CardStatus = "active" | "suspended" | "expired";

  export interface BootConfig {
    siteId?: string;
    apiKey?: string;
    logLevel?: LogLevel;
    rssiThreshold?: number;
    /** Ties this device to the token your backend issued it. */
    correlationId?: string;
    /** Days of log kept. Default 7. A privacy control — 0 keeps everything. */
    retentionDays?: number;
    /** Capture a bundle after this many consecutive failed unlocks. 0 = off. */
    autoBundleAfterFailures?: number;
  }

  export interface Card {
    id: string;
    name: string;
    siteName: string;
    status: CardStatus;
    accessLevels?: string[];
  }

  export interface Status {
    sdkReady: boolean;
    mock: boolean;
    registered: boolean;
    bluetooth: "on" | "off" | "unauthorized" | "unsupported";
    permissions: "granted" | "denied" | "partial";
    licence: "valid" | "expired" | "unknown";
    cardCount: number;
    version: string;
  }

  export type RemediationAction =
    | "openBluetoothSettings"
    | "openAppSettings"
    | "openLocationSettings"
    | "openNotificationSettings"
    | "openBatterySettings"
    | "requestBatteryExemption";

  export interface Check {
    id: string;
    label: string;
    state: CheckState;
    detail: string;
    /** Pass to remediate(). Null when the user cannot fix it from settings. */
    action: RemediationAction | null;
    /** Button text for action. */
    actionLabel: string | null;
    /** Guidance to show when there is no action, or alongside one on iOS. */
    remedy: string | null;
  }

  export interface Diagnostics {
    checks: Check[];
    summary: "pass" | "fail";
    device: { platform: string; model: string; osVersion: string };
  }

  export interface LogEntry {
    ts: string;
    /** Present when a correlation id is set. */
    cid?: string;
    lvl: Exclude<LogLevel, "off">;
    src: LogSource;
    code: string;
    msg: string;
    data?: Record<string, unknown>;
  }

  export interface SupportBundle {
    path: string | null;
    content: {
      generatedAt: string;
      package: string;
      entryCount: number;
      correlationId: string | null;
      retentionDays: number;
      droppedOlderEntries: number;
      trigger?: string;
      failureStreak?: number;
      entries: LogEntry[];
      [key: string]: unknown;
    };
  }

  export type AirfobEvent =
    | { name: "status"; status: Status }
    | { name: "readerDetected"; readerId: string; rssi: number }
    | { name: "unlockResult"; result: UnlockResult; readerId?: string; rssi?: number }
    | { name: "error"; code: string; message: string }
    | { name: "supportBundleReady"; reason: string; failureStreak: number };

  export interface AirfobLog {
    get(options?: { since?: string; level?: LogLevel; limit?: number }): Promise<LogEntry[]>;
    setLevel(level: LogLevel): LogLevel;
    getLevel(): LogLevel;
    setRetentionDays(days: number): number;
    getRetentionDays(): number;
    clear(): Promise<void>;
    subscribe(handler: (entry: LogEntry) => void): () => void;
    write(level: Exclude<LogLevel, "off">, source: LogSource, code: string, message: string, data?: object): void;
    export(context?: Record<string, unknown>): Promise<SupportBundle>;
  }

  export interface Airfob {
    readonly version: string;
    readonly isMock: boolean;

    boot(config?: BootConfig): Promise<{ sdkReady: boolean; mock: boolean; version: string }>;

    /** Change settings without re-booting. */
    configure(config?: BootConfig): {
      logLevel: LogLevel;
      retentionDays: number;
      correlationId: string | null;
      autoBundleAfterFailures: number;
    };

    setCorrelationId(id: string | null): string | null;

    /** Collects an automatically captured bundle and clears it. */
    takePendingBundle(): SupportBundle | null;
    hasPendingBundle(): boolean;
    /** Consecutive failed unlocks; any success resets it. */
    getFailureStreak(): number;
    getStatus(): Promise<Status>;

    register(token: string): Promise<{ cards: Card[] }>;
    getCards(): Promise<{ cards: Card[] }>;
    unregister(cardId?: string): Promise<{ cards: Card[] }>;

    unlock(cardId?: string): Promise<{ result: UnlockResult; rssi?: number }>;

    getDiagnostics(): Promise<Diagnostics>;
    requestPermissions(): Promise<{ granted: boolean; missing: string[] }>;

    /**
     * Opens the settings screen that fixes a check. Android deep-links exactly;
     * iOS can only open this app settings page and rejects openBatterySettings.
     */
    remediate(actionId: RemediationAction): Promise<{ opened: boolean; mock?: boolean }>;

    getRawState(): Promise<Record<string, unknown>>;
    resetRssi(): Promise<{ reset: boolean }>;

    log: AirfobLog;

    /** Mock only. */
    setScenario(name: string): Promise<Status>;
    listScenarios(): Promise<{ scenarios: string[] }>;

    on(handler: (event: AirfobEvent) => void): () => void;
  }

  const Airfob: Airfob;
  export default Airfob;
}
