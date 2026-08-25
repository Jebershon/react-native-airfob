/**
 * In-JS implementation of the whole native surface.
 *
 * Used automatically when the native module is absent — Make It Native, a plain
 * Metro bundle, Jest, or any build made before the SDK was linked. It is the
 * reason the entire chain (Mendix page -> JS action -> package) is demoable
 * without an Airfob licence.
 *
 * It deliberately models the *failure* modes too. `setScenario()` lets QA force
 * a flat battery of broken states so the diagnostics screen can be exercised
 * without hunting for a misbehaving handset.
 */
import { CHECK, ERRORS, EVENTS, REMEDIATION } from "./constants.js";

const SCENARIOS = {
  happy: {},
  btOff: { bluetooth: "off" },
  noPermission: { permissions: "denied" },
  noCard: { cards: [] },
  expiredCard: { cardStatus: "expired" },
  noReader: { unlockResult: "noReader" },
  denied: { unlockResult: "denied" },
  licenceExpired: { licence: "expired" }
};

export function createMock({ log }) {
  const listeners = new Set();

  let booted = false;
  let scenario = "happy";
  let overrides = {};
  let cards = [];

  const emit = payload => {
    listeners.forEach(fn => {
      try {
        fn(payload);
      } catch (e) {
        log.write("error", "bridge", "E_LISTENER", e.message);
      }
    });
  };

  const value = (key, fallback) =>
    Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;

  const makeCard = token => ({
    id: "mock-" + String(token || "card").slice(0, 8),
    name: "Mock Credential",
    siteName: "Mock Site",
    status: value("cardStatus", "active"),
    accessLevels: ["All doors"]
  });

  const buildStatus = () => ({
    sdkReady: booted,
    mock: true,
    registered: cards.length > 0,
    bluetooth: value("bluetooth", "on"),
    permissions: value("permissions", "granted"),
    licence: value("licence", "valid"),
    cardCount: cards.length,
    scenario
  });

  const pushStatus = () => emit({ name: EVENTS.STATUS, status: buildStatus() });

  const fail = (code, message) => {
    log.write("error", "sdk", code, message);
    const error = new Error(message);
    error.code = code;
    return Promise.reject(error);
  };

  return {
    isMock: true,

    /* ---------------------------------------------------------- lifecycle -- */

    async boot(config = {}) {
      booted = true;
      log.setLevel(config.logLevel || "info");
      log.write("info", "sdk", "BOOT", "Mock SDK booted", {
        siteId: config.siteId || null
      });
      pushStatus();
      return { sdkReady: true, mock: true };
    },

    async getStatus() {
      return buildStatus();
    },

    /* ------------------------------------------------------- credentials -- */

    async register({ token } = {}) {
      if (!booted) return fail(ERRORS.NOT_READY, "boot() has not been called");
      if (!token) return fail(ERRORS.SDK, "register requires a token");

      cards = value("cards", [makeCard(token)]);
      log.write("info", "sdk", "REGISTER", `Registered ${cards.length} credential(s)`);
      pushStatus();
      return { cards };
    },

    async getCards() {
      return { cards };
    },

    async unregister() {
      cards = [];
      log.write("info", "sdk", "UNREGISTER", "Credentials cleared");
      pushStatus();
      return { cards };
    },

    /* ------------------------------------------------------------ unlock -- */

    async unlock({ cardId } = {}) {
      if (!booted) return fail(ERRORS.NOT_READY, "boot() has not been called");
      if (value("licence", "valid") === "expired") {
        return fail(ERRORS.LICENCE, "Airfob SDK licence has expired");
      }
      if (value("bluetooth", "on") !== "on") {
        return fail(ERRORS.BT_OFF, "Bluetooth is off");
      }
      if (value("permissions", "granted") !== "granted") {
        return fail(ERRORS.PERMISSION, "Bluetooth permission not granted");
      }
      if (!cards.length) {
        return fail(ERRORS.NO_CARD, "No credential registered on this device");
      }

      const result = value("unlockResult", "opened");
      const rssi = result === "noReader" ? -98 : -62;

      log.write("debug", "ble", "SCAN", `Scanning for readers (rssi ${rssi})`);

      if (result !== "opened") {
        const code = result === "noReader" ? ERRORS.NO_READER : ERRORS.SDK;
        emit({ name: EVENTS.UNLOCK_RESULT, result, rssi });
        return fail(code, `Unlock failed: ${result}`);
      }

      log.write("info", "ble", "UNLOCK", "Door opened", {
        cardId: cardId || cards[0].id,
        rssi
      });
      // Real readers answer asynchronously; keep the shape honest.
      setTimeout(() => {
        emit({ name: EVENTS.UNLOCK_RESULT, result: "opened", readerId: "mock-reader", rssi });
      }, 250);

      return { result: "opened", rssi };
    },

    /* ------------------------------------------------------- diagnostics -- */

    async getDiagnostics() {
      const status = buildStatus();
      const btOk = status.bluetooth === "on";
      const permOk = status.permissions === "granted";
      const cardsActive = cards.length > 0 && cards.every(c => c.status === "active");
      const licenceOk = status.licence === "valid";

      const checks = [
        {
          id: "bluetooth",
          label: "Bluetooth enabled",
          state: btOk ? CHECK.PASS : CHECK.FAIL,
          detail: status.bluetooth,
          action: btOk ? null : REMEDIATION.BLUETOOTH,
          actionLabel: btOk ? null : "Turn on Bluetooth",
          remedy: null
        },
        {
          id: "permissions",
          label: "Bluetooth permissions granted",
          state: permOk ? CHECK.PASS : CHECK.FAIL,
          detail: status.permissions,
          action: permOk ? null : REMEDIATION.APP_SETTINGS,
          actionLabel: permOk ? null : "Open app permissions",
          remedy: null
        },
        {
          id: "credential",
          label: "Credential present",
          state: status.registered ? CHECK.PASS : CHECK.FAIL,
          detail: `${status.cardCount} card(s)`,
          action: null,
          actionLabel: null,
          remedy: status.registered ? null : "Activate your access from the home screen."
        },
        {
          id: "credentialStatus",
          label: "Credential active",
          state: cardsActive ? CHECK.PASS : CHECK.FAIL,
          detail: cards.map(c => c.status).join(", ") || "none",
          action: null,
          actionLabel: null,
          remedy: cardsActive
            ? null
            : "Your access has been suspended or has expired. Contact your administrator."
        },
        {
          id: "licence",
          label: "SDK licence valid",
          state: licenceOk ? CHECK.PASS : CHECK.FAIL,
          detail: status.licence,
          action: null,
          actionLabel: null,
          remedy: licenceOk
            ? null
            : "The Airfob licence for this app has expired. This needs an administrator."
        },
        {
          id: "native",
          label: "Native SDK linked",
          state: CHECK.WARN,
          detail: "Running the JS mock — no native module in this build",
          action: null,
          actionLabel: null,
          remedy: "Expected in Make It Native and in builds made before P5."
        }
      ];

      return {
        checks,
        summary: checks.some(c => c.state === CHECK.FAIL) ? "fail" : "pass",
        device: { platform: "mock", model: "Mock Device", osVersion: "0" }
      };
    },

    /**
     * No settings screen exists to open from a JS mock, so this reports what the
     * real implementation *would* do. Returning `opened: false` rather than
     * throwing keeps the diagnostics UI on one code path.
     */
    async remediate(actionId) {
      if (!Object.values(REMEDIATION).includes(actionId)) {
        return fail(ERRORS.SDK, `Unknown remediation action "${actionId}"`);
      }
      log.write("info", "perm", "REMEDIATE_MOCK", `Would open settings for ${actionId}`);
      return { opened: false, mock: true };
    },

    async getRawState() {
      const status = buildStatus();
      return {
        platform: "mock",
        mock: true,
        scenario,
        booted,
        overrides: JSON.stringify(overrides),
        sdkReady: status.sdkReady,
        registered: status.registered,
        cardCount: status.cardCount,
        licence: status.licence,
        bluetooth: status.bluetooth,
        permissions: status.permissions,
        logLevel: log.getLevel()
      };
    },

    async resetRssi() {
      log.write("info", "ble", "RSSI_RESET", "Cached reader RSSI values cleared");
      return { reset: true };
    },

    /* -------------------------------------------------------------- test -- */

    /** QA hook: force a known-broken state. Not present on the real module. */
    async setScenario(name) {
      if (!SCENARIOS[name]) {
        return fail(ERRORS.SDK, `Unknown scenario "${name}"`);
      }
      scenario = name;
      overrides = { ...SCENARIOS[name] };
      if (overrides.cards) cards = overrides.cards;
      log.write("warn", "sdk", "SCENARIO", `Mock scenario set to "${name}"`);
      pushStatus();
      return buildStatus();
    },

    async listScenarios() {
      return { scenarios: Object.keys(SCENARIOS) };
    },

    /* ------------------------------------------------------------ events -- */

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
