/** Shared vocabulary. Keep in sync with AirfobLog.kt / AirfobLog.swift. */

export const LOG_LEVELS = ["off", "error", "warn", "info", "debug"];

/** Numeric so comparisons are cheap on the native side too. */
export const LEVEL_VALUE = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

/** Where a log entry came from. */
export const LOG_SOURCES = ["sdk", "ble", "perm", "service", "bridge", "licence"];

export const ERRORS = {
  NO_NATIVE: "E_NO_NATIVE",
  NOT_READY: "E_NOT_READY",
  PERMISSION: "E_PERMISSION",
  BT_OFF: "E_BT_OFF",
  NO_CARD: "E_NO_CARD",
  NO_READER: "E_NO_READER",
  LICENCE: "E_LICENCE",
  SDK: "E_SDK"
};

/** Events emitted to `Airfob.on(handler)`. */
export const EVENTS = {
  STATUS: "status",
  READER_DETECTED: "readerDetected",
  UNLOCK_RESULT: "unlockResult",
  LOG: "log",
  ERROR: "error"
};

/** Result of an unlock attempt. */
export const UNLOCK_RESULTS = ["opened", "noReader", "denied", "error"];

/** Diagnostic check outcomes. */
export const CHECK = {
  PASS: "pass",
  FAIL: "fail",
  WARN: "warn",
  UNKNOWN: "unknown"
};

/**
 * Remediation action ids. Shared with both native sides so one Mendix page can
 * render either platform.
 *
 * Android deep-links to the exact settings screen. iOS has only one public
 * destination — the app's own settings page — so several of these resolve to the
 * same place there, and the guidance lives in the check's `remedy` text instead.
 * `openBatterySettings` has no iOS equivalent at all and is rejected there.
 */
export const REMEDIATION = {
  BLUETOOTH: "openBluetoothSettings",
  APP_SETTINGS: "openAppSettings",
  LOCATION: "openLocationSettings",
  NOTIFICATIONS: "openNotificationSettings",
  BATTERY: "openBatterySettings",
  BATTERY_EXEMPTION: "requestBatteryExemption"
};
