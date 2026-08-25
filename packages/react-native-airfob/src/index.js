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
import { CHECK, ERRORS, EVENTS, LOG_LEVELS, REMEDIATION, UNLOCK_RESULTS } from "./constants.js";
import { impl, isMock, log } from "./nativeModule.js";

const VERSION = "0.3.0";

let bootConfig = null;
let bootPromise = null;

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
    if (bootPromise) return bootPromise;

    bootConfig = config;
    if (config.logLevel) log.setLevel(config.logLevel);

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
    return impl.unlock({ cardId });
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

  log: {
    get: options => log.get(options),
    setLevel: level => log.setLevel(level),
    getLevel: () => log.getLevel(),
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
    return impl.subscribe(handler);
  },

  /* ----------------------------------------------------------- constants -- */

  EVENTS,
  ERRORS,
  CHECK,
  LOG_LEVELS,
  REMEDIATION,
  UNLOCK_RESULTS
};

export default Airfob;
export { CHECK, ERRORS, EVENTS, LOG_LEVELS, REMEDIATION, UNLOCK_RESULTS };
