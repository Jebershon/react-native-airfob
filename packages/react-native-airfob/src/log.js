/**
 * Structured log with a bounded ring buffer.
 *
 * When the native module is present every write is forwarded to it, so JS and
 * native entries land in the same on-disk JSONL file and interleave correctly.
 * Without it, the ring lives here in memory so the mock still produces something
 * the diagnostics screen can render.
 *
 * The on-device log is the primary debugging artefact for this package: BLE
 * access control fails silently, in a pocket, on a handset you do not have.
 */
import { DEFAULTS, LEVEL_VALUE, LOG_LEVELS } from "./constants.js";

const RING_CAPACITY = 500;

export function createLog({ getNative }) {
  const ring = [];
  const listeners = new Set();
  let level = "info";
  let retentionDays = DEFAULTS.RETENTION_DAYS;
  let correlationId = null;

  const shouldWrite = entryLevel =>
    LEVEL_VALUE[entryLevel] <= LEVEL_VALUE[level] && level !== "off";

  /** Entries older than the retention window are dropped, not merely hidden. */
  const cutoff = () =>
    retentionDays > 0
      ? new Date(Date.now() - retentionDays * 86400000).toISOString()
      : null;

  const prune = () => {
    const limit = cutoff();
    if (!limit) return;
    while (ring.length && ring[0].ts < limit) ring.shift();
  };

  const push = entry => {
    ring.push(entry);
    if (ring.length > RING_CAPACITY) ring.shift();
    prune();
    listeners.forEach(fn => {
      try {
        fn(entry);
      } catch (e) {
        // A log listener must never take the app down.
      }
    });
  };

  const api = {
    /**
     * @param {"error"|"warn"|"info"|"debug"} entryLevel
     * @param {"sdk"|"ble"|"perm"|"service"|"bridge"|"licence"} source
     * @param {string} code   short stable identifier, e.g. "UNLOCK"
     * @param {string} message
     * @param {object} [data] extra structured fields
     */
    write(entryLevel, source, code, message, data) {
      if (!shouldWrite(entryLevel)) return;

      const entry = {
        ts: new Date().toISOString(),
        lvl: entryLevel,
        src: source,
        code,
        msg: message,
        // Token issuance happens in your backend, the unlock happens on the
        // device. Without a shared id there is no way to join the two halves
        // when something goes wrong, and it cannot be retrofitted afterwards.
        ...(correlationId ? { cid: correlationId } : {}),
        ...(data ? { data } : {})
      };

      push(entry);

      const native = getNative();
      if (native && native.logWrite) {
        // Fire and forget — a failed log write must not fail the caller.
        native.logWrite(entry).catch(() => {});
      }
    },

    setLevel(next) {
      if (!LOG_LEVELS.includes(next)) {
        throw new Error(`Unknown log level "${next}". Use one of: ${LOG_LEVELS.join(", ")}`);
      }
      level = next;
      const native = getNative();
      if (native && native.logSetLevel) native.logSetLevel(next).catch(() => {});
      return level;
    },

    getLevel() {
      return level;
    },

    /**
     * @param {number} days 0 keeps everything — only do that deliberately, and
     *   only where you have a lawful basis to.
     */
    setRetentionDays(days) {
      if (typeof days !== "number" || days < 0) {
        throw new Error(`Retention must be a non-negative number of days, got ${days}`);
      }
      retentionDays = days;
      const native = getNative();
      if (native && native.logSetRetention) native.logSetRetention(days).catch(() => {});
      prune();
      return retentionDays;
    },

    getRetentionDays() {
      return retentionDays;
    },

    /** Stamped onto every subsequent entry. Pass null to stop. */
    setCorrelationId(id) {
      correlationId = id || null;
      return correlationId;
    },

    getCorrelationId() {
      return correlationId;
    },

    /**
     * Newest last. Native entries win when both exist, because the native ring
     * survives an app restart and the JS one does not.
     */
    async get({ since, level: minLevel, limit } = {}) {
      const native = getNative();
      let entries = ring;

      if (native && native.logGet) {
        try {
          const result = await native.logGet({ since: since || null });
          if (result && Array.isArray(result.entries)) entries = result.entries;
        } catch (e) {
          // Fall through to the JS ring.
        }
      }

      let out = entries;
      const limitTs = cutoff();
      // Applied on read as well as on write: the native ring survives process
      // death, so it can hand back entries that aged out while the app was gone.
      if (limitTs) out = out.filter(e => e.ts >= limitTs);
      if (since) out = out.filter(e => e.ts >= since);
      if (minLevel) out = out.filter(e => LEVEL_VALUE[e.lvl] <= LEVEL_VALUE[minLevel]);
      if (limit) out = out.slice(-limit);
      return out;
    },

    async clear() {
      ring.length = 0;
      const native = getNative();
      if (native && native.logClear) await native.logClear();
    },

    /**
     * Everything a support engineer needs in one blob: the log plus the context
     * that explains it. This is what gets attached to a ticket.
     */
    async export(context = {}) {
      const all = await api.get();

      // Cap the payload. A bundle is uploaded over a phone connection and stored
      // per ticket; an unbounded one is a bad citizen in both directions.
      const entries = all.slice(-DEFAULTS.MAX_BUNDLE_ENTRIES);
      const dropped = all.length - entries.length;

      const bundle = {
        generatedAt: new Date().toISOString(),
        package: "react-native-airfob",
        correlationId,
        retentionDays,
        ...context,
        entryCount: entries.length,
        // Silent truncation reads as "this is everything". Say what was cut.
        droppedOlderEntries: dropped,
        entries
      };

      const native = getNative();
      if (native && native.logExport) {
        try {
          const { path } = await native.logExport(JSON.stringify(bundle));
          return { path, content: bundle };
        } catch (e) {
          // Fall through: still hand back the content so callers can upload it.
        }
      }
      return { path: null, content: bundle };
    },

    /** fn(entry) -> unsubscribe. Powers a live log view in the dev panel. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };

  return api;
}
