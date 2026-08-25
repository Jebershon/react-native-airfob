/**
 * Resolves the implementation the rest of the package talks to: the real native
 * module when it is linked, the JS mock otherwise.
 *
 * Deliberately does NOT throw when the native module is missing. Mendix's own
 * native-module guidance throws in that case, which makes the Make It Native app
 * crash rather than degrade — and Make It Native can never contain custom native
 * code, so that is the normal state for a Mendix developer building pages.
 * Reporting `sdkReady: false` lets those pages render and explain themselves.
 */
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import { createLog } from "./log.js";
import { createMock } from "./mock.js";

const NATIVE_MODULE_NAME = "Airfob";
const EVENT_NAME = "airfob";

const native = NativeModules[NATIVE_MODULE_NAME] || null;

export const isMock = !native;

export const log = createLog({ getNative: () => native });

/* ------------------------------------------------------------ real module -- */

function wrap(method, fallbackCode) {
  return async (...args) => {
    try {
      return await native[method](...args);
    } catch (error) {
      // RN maps promise.reject(code, message) onto error.code — keep it, and
      // give anything that slips through a stable code so callers can branch.
      if (!error.code) error.code = fallbackCode;
      log.write("error", "bridge", error.code, `${method} failed: ${error.message}`);
      throw error;
    }
  };
}

function createNativeImpl() {
  const emitter = new NativeEventEmitter(native);

  return {
    isMock: false,

    boot: wrap("boot", "E_NOT_READY"),
    getStatus: wrap("getStatus", "E_SDK"),
    register: wrap("register", "E_SDK"),
    getCards: wrap("getCards", "E_SDK"),
    unregister: wrap("unregister", "E_SDK"),
    unlock: wrap("unlock", "E_SDK"),
    getDiagnostics: wrap("getDiagnostics", "E_SDK"),
    remediate: wrap("remediate", "E_SDK"),
    getRawState: wrap("getRawState", "E_SDK"),
    resetRssi: wrap("resetRssi", "E_SDK"),
    requestPermissions: wrap("requestPermissions", "E_PERMISSION"),

    // Present only on the mock; keep the shape so callers need no branching.
    async setScenario() {
      const error = new Error("Scenarios are only available on the mock implementation");
      error.code = "E_SDK";
      throw error;
    },
    async listScenarios() {
      return { scenarios: [] };
    },

    subscribe(fn) {
      const subscription = emitter.addListener(EVENT_NAME, fn);
      return () => subscription.remove();
    }
  };
}

/* ------------------------------------------------------------------ pick --- */

export const impl = native ? createNativeImpl() : createMock({ log });

if (isMock) {
  log.write(
    "warn",
    "bridge",
    "NO_NATIVE",
    `Native module "${NATIVE_MODULE_NAME}" not found on ${Platform.OS} — using the JS mock. ` +
      "This is expected in Make It Native, Jest, and any build made before the SDK was linked."
  );
}
