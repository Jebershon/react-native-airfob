/**
 * react-native-airfob — public API.
 *
 * This is the only surface Mendix JavaScript actions, the WebView bridge, or any
 * other consumer should import. Nothing above this file touches NativeModules,
 * and nothing above it knows the Airfob SDK exists.
 *
 *   import Airfob from "react-native-airfob";
 *   await Airfob.boot({ siteId: "…" });
 *   const { result } = await Airfob.unlock();
 *
 * Note on tap-and-go: `boot()` is a safety net, not the primary path. The SDK is
 * started from native app-launch code so scanning survives the JS layer being
 * torn down — which is the normal state when a user taps their phone on a reader
 * without opening the app.
 */
import {
  CHECK,
  DEFAULTS,
  ERRORS,
  EVENTS,
  LOG_LEVELS,
  REMEDIATION,
  UNLOCK_RESULTS
} from "./constants.js";
import { impl, isMock, log } from "./nativeModule.js";

const VERSION = "0.5.0";

let bootConfig = null;
let bootPromise = null;

/* ------------------------------------------------- automatic support capture */

let failureStreak = 0;
let autoBundleAfter = DEFAULTS.AUTO_BUNDLE_AFTER_FAILURES;
let pendingBundle = null;

/**
 * Captures a bundle once a run of unlocks has failed, so the evidence exists
 * before the user gives up and calls the helpdesk. Held on the device rather
 * than uploaded: this package never talks to your backend.
 */
async function captureBundle(reason) {
  if (pendingBundle) return; // one is already waiting to be collected
  try {
    const bundle = await log.export({
      version: VERSION,
      mock: isMock,
      siteId: bootConfig?.siteId ?? null,
      trigger: reason,
      failureStreak
    });
    pendingBundle = bundle;
    log.write("warn", "bridge", "AUTO_BUNDLE", `Captured after ${failureStreak} failures`);
    notify({ name: EVENTS.SUPPORT_BUNDLE, reason, failureStreak });
  } catch (e) {
    log.write("error", "bridge", "AUTO_BUNDLE_FAIL", e.message || String(e));
  }
}

function recordUnlockOutcome(opened) {
  if (opened) {
    failureStreak = 0;
    return;
  }
  failureStreak += 1;
  if (autoBundleAfter > 0 && failureStreak >= autoBundleAfter) {
    captureBundle("repeatedUnlockFailure");
  }
}

/* ------------------------------------------------------------------ events -- */

const listeners = new Set();

function notify(event) {
  listeners.forEach(fn => {
    try {
      fn(event);
    } catch (e) {
      log.write("error", "bridge", "E_LISTENER", e.message || String(e));
    }
  });
}

/**
 * A JS-initiated unlock produces two signals for the same attempt: the promise
 * outcome, and a native unlockResult event. Counting both doubles the streak and
 * fires auto-capture at half the configured threshold, so the event is ignored
 * for a moment after unlock() is called.
 *
 * Tap-and-go events arrive with no JS on the call stack and are always counted —
 * which is the whole point, since that is where real failures happen.
 */
let suppressEventCountingUntil = 0;
const UNLOCK_EVENT_WINDOW_MS = 1000;

impl.subscribe(event => {
  if (event?.name === EVENTS.UNLOCK_RESULT && Date.now() >= suppressEventCountingUntil) {
    recordUnlockOutcome(event.result === "opened");
  }
  notify(event);
});

/** Applied on every boot() call, not just the first, and by configure(). */
function applyConfig(config) {
  if (config.logLevel) log.setLevel(config.logLevel);
  if (config.correlationId !== undefined) log.setCorrelationId(config.correlationId);
  if (typeof config.retentionDays === "number") log.setRetentionDays(config.retentionDays);
  if (typeof config.autoBundleAfterFailures === "number") {
    autoBundleAfter = config.autoBundleAfterFailures;
  }
}

const Airfob = {
  version: VERSION,
  isMock,

  /* ---------------------------------------------------------- lifecycle --- */

  /**
   * Idempotent. Safe to call from an after-startup nanoflow and from any page.
   * Concurrent callers share one in-flight boot.
   *
   * @param {{siteId?: string, apiKey?: string, logLevel?: string, rssiThreshold?: number}} config
   */
  async boot(config = {}) {
    // Settings apply on every call. Only the SDK start is idempotent — silently
    // dropping config because boot already ran would be a trap.
    bootConfig = { ...(bootConfig || {}), ...config };
    applyConfig(config);

    if (bootPromise) return bootPromise;

    bootPromise = impl
      .boot(config)
      .then(result => {
        log.write("info", "sdk", "BOOT_OK", "Airfob booted", { mock: isMock });
        return { ...result, mock: isMock, version: VERSION };
      })
      .catch(error => {
        bootPromise = null; // allow a retry
        throw error;
      });

    return bootPromise;
  },

  /**
   * Change settings without re-booting. Same fields as boot().
   * Useful for setting a correlation id at sign-in, or turning on automatic
   * support capture for one user while diagnosing a problem.
   */
  configure(config = {}) {
    bootConfig = { ...(bootConfig || {}), ...config };
    applyConfig(config);
    return {
      logLevel: log.getLevel(),
      retentionDays: log.getRetentionDays(),
      correlationId: log.getCorrelationId(),
      autoBundleAfterFailures: autoBundleAfter
    };
  },

  /** Current state. Cheap — safe to call on every page show. */
  async getStatus() {
    const status = await impl.getStatus();
    return { ...status, mock: isMock, version: VERSION };
  },

  /* -------------------------------------------------------- credentials --- */

  /**
   * @param {string} token issued by your backend against the Airfob API.
   *   This package never talks to your backend — hand it the token you already
   *   have, so token issuance stays a Mendix concern and the package stays
   *   reusable across projects.
   */
  async register(token) {
    return impl.register({ token });
  },

  async getCards() {
    return impl.getCards();
  },

  async unregister(cardId) {
    return impl.unregister({ cardId });
  },

  /* ------------------------------------------------------------- unlock --- */

  /**
   * Manual unlock. Tap-and-go does not go through here — the SDK opens the door
   * on proximity with no JS involved. This is the fallback button for lifts,
   * gates, and taps that did not land.
   */
  async unlock(cardId) {
    suppressEventCountingUntil = Date.now() + UNLOCK_EVENT_WINDOW_MS;
    try {
      const outcome = await impl.unlock({ cardId });
      recordUnlockOutcome(outcome?.result === "opened");
      return outcome;
    } catch (e) {
      recordUnlockOutcome(false);
      throw e;
    }
  },

  /* --------------------------------------------------- readiness / debug --- */

  /**
   * Every precondition that has to hold for a tap to work. Each check carries a
   * state, a human detail, and either an `action` for {@link remediate} or a
   * `remedy` string when the user has to be told rather than sent somewhere.
   * Renders directly as the diagnostics screen.
   */
  async getDiagnostics() {
    return impl.getDiagnostics();
  },

  /** Android only in practice; resolves immediately elsewhere. */
  async requestPermissions() {
    if (!impl.requestPermissions) return { granted: true, missing: [] };
    return impl.requestPermissions();
  },

  /**
   * Opens the OS settings screen that fixes a failing check. Pass the check's
   * `action` value; skip checks where it is null and show `remedy` instead.
   *
   * Android lands on the exact screen. iOS can only open this app's settings
   * page, so several ids resolve to the same place there and `openBatterySettings`
   * is rejected outright — iOS has no per-app battery exemption. Always render
   * `remedy` alongside the button so the user knows what to do once they arrive.
   */
  async remediate(actionId) {
    return impl.remediate(actionId);
  },

  /** Verbose internal state. For the dev panel and support bundles. */
  async getRawState() {
    return impl.getRawState();
  },

  /**
   * Clears cached per-reader RSSI baselines. First thing to try when one
   * specific door starts refusing taps after a reader was moved or replaced.
   */
  async resetRssi() {
    return impl.resetRssi();
  },

  /**
   * Ties a device to the token your backend issued it. Without one there is no
   * way to join a failed unlock to the enrolment that produced the credential.
   * Set it at boot, or here when the user signs in.
   */
  setCorrelationId(id) {
    return log.setCorrelationId(id);
  },

  /**
   * Collects a bundle captured automatically after repeated failures, and clears
   * it. Returns null when there is nothing waiting.
   *
   * Polled rather than pushed because a Mendix Action parameter takes no
   * arguments, so a nanoflow callback cannot receive the bundle.
   */
  takePendingBundle() {
    const bundle = pendingBundle;
    pendingBundle = null;
    return bundle;
  },

  hasPendingBundle() {
    return pendingBundle !== null;
  },

  /** Consecutive failed unlocks. Reset by any success. */
  getFailureStreak() {
    return failureStreak;
  },

  log: {
    get: options => log.get(options),
    setLevel: level => log.setLevel(level),
    getLevel: () => log.getLevel(),
    setRetentionDays: days => log.setRetentionDays(days),
    getRetentionDays: () => log.getRetentionDays(),
    clear: () => log.clear(),
    subscribe: fn => log.subscribe(fn),
    write: (level, source, code, message, data) => log.write(level, source, code, message, data),

    /** Support bundle: the log plus the context that explains it. */
    export: async (context = {}) =>
      log.export({
        version: VERSION,
        mock: isMock,
        siteId: bootConfig?.siteId ?? null,
        ...context
      })
  },

  /* --------------------------------------------------------------- test --- */

  /** Mock only. Forces a known-broken state so the diagnostics UI can be tested. */
  async setScenario(name) {
    return impl.setScenario(name);
  },

  async listScenarios() {
    return impl.listScenarios();
  },

  /* ------------------------------------------------------------- events --- */

  /**
   * @param {(event: {name: string}) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },

  /* ----------------------------------------------------------- constants -- */

  EVENTS,
  ERRORS,
  CHECK,
  DEFAULTS,
  LOG_LEVELS,
  REMEDIATION,
  UNLOCK_RESULTS
};

export default Airfob;
export { CHECK, DEFAULTS, ERRORS, EVENTS, LOG_LEVELS, REMEDIATION, UNLOCK_RESULTS };
