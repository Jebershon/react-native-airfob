/**
 * Airfob example app.
 *
 * Two jobs:
 *
 *  1. Make the debug loop fast. Studio Pro -> Native Builder -> device is 15-20
 *     minutes; this is a Metro reload. Reproduce every native bug here before
 *     opening Mendix.
 *  2. Be the reference for the Mendix pages in P3. The two screens below map
 *     one-to-one onto "Activate access" and "Access status", and the dev panel
 *     shows what the hidden support surface needs to expose.
 *
 * The dev panel is hidden behind a long-press on the version line, exactly as it
 * should ship in production: present on every install, invisible until someone
 * who knows about it needs it on a customer site.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme
} from "react-native";

import Airfob from "react-native-airfob";

const STATE_COLOURS = {
  pass: "#1a7f37",
  warn: "#9a6700",
  fail: "#cf222e",
  unknown: "#57606a"
};

export default function App() {
  const dark = useColorScheme() === "dark";
  const theme = dark ? darkTheme : lightTheme;

  const [status, setStatus] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [entries, setEntries] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [rawState, setRawState] = useState(null);
  const [busy, setBusy] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [devPanel, setDevPanel] = useState(false);

  const refresh = useCallback(async () => {
    const [nextStatus, nextDiagnostics, nextEntries] = await Promise.all([
      Airfob.getStatus(),
      Airfob.getDiagnostics(),
      Airfob.log.get({ limit: 40 })
    ]);
    setStatus(nextStatus);
    setDiagnostics(nextDiagnostics);
    setEntries(nextEntries.slice().reverse());
  }, []);

  const run = useCallback(
    async (label, fn) => {
      setBusy(label);
      try {
        return await fn();
      } catch (error) {
        Airfob.log.write("error", "bridge", error.code || "E_SDK", `${label}: ${error.message}`);
        Alert.alert(label, `${error.code || "E_SDK"}\n\n${error.message}`);
        return null;
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh]
  );

  useEffect(() => {
    // boot() is idempotent — safe here even though native already booted at
    // launch. This mirrors what the Mendix after-startup nanoflow does.
    Airfob.boot({ siteId: "example-site", logLevel: "debug" })
      .catch(() => {})
      .then(refresh);

    Airfob.listScenarios().then(r => setScenarios(r.scenarios)).catch(() => {});

    const offEvent = Airfob.on(event => {
      setLastEvent(event);
      refresh();
    });
    const offLog = Airfob.log.subscribe(() => {
      Airfob.log.get({ limit: 40 }).then(next => setEntries(next.slice().reverse()));
    });

    return () => {
      offEvent();
      offLog();
    };
  }, [refresh]);

  const toggleDevPanel = useCallback(async () => {
    const next = !devPanel;
    setDevPanel(next);
    if (next) {
      setRawState(await Airfob.getRawState().catch(() => null));
    }
  }, [devPanel]);

  const failing = diagnostics?.checks?.filter(c => c.state !== "pass") ?? [];
  const ready = diagnostics?.summary === "pass";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: theme.fg }]}>Airfob</Text>

        {/* Long-press here for the dev panel. */}
        <TouchableOpacity onLongPress={toggleDevPanel} delayLongPress={800} activeOpacity={1}>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            v{Airfob.version}
            {Airfob.isMock ? "  ·  JS mock" : "  ·  native linked"}
            {status?.mock ? "  ·  MockAirfobSdk" : ""}
            {devPanel ? "  ·  DEV" : ""}
          </Text>
        </TouchableOpacity>

        {/* --- Screen 1: activate access ------------------------------------ */}

        <Section title="Access" theme={theme}>
          <Text style={[styles.big, { color: ready ? STATE_COLOURS.pass : STATE_COLOURS.fail }]}>
            {ready ? "Ready to tap" : failing.length + " issue" + (failing.length === 1 ? "" : "s")}
          </Text>
          <Text style={[styles.hint, { color: theme.muted }]}>
            {status?.registered
              ? "Hold your phone near a reader. You do not need to open this app."
              : "You have no credential on this device yet."}
          </Text>
          <Row>
            {!status?.registered ? (
              <Button
                label="Activate access"
                busy={busy === "Activate"}
                theme={theme}
                onPress={() =>
                  run("Activate", () => Airfob.register(`demo-token-${Date.now()}`))
                }
              />
            ) : (
              <Button
                label="Unlock manually"
                busy={busy === "Unlock"}
                theme={theme}
                onPress={() => run("Unlock", () => Airfob.unlock())}
              />
            )}
          </Row>
        </Section>

        {/* --- Screen 2: readiness + diagnostics ---------------------------- */}

        <Section title="Diagnostics" theme={theme}>
          {diagnostics?.checks?.map(check => (
            <CheckRow
              key={check.id}
              check={check}
              theme={theme}
              busy={busy === check.id}
              onRemediate={() =>
                run(check.id, async () => {
                  const result = await Airfob.remediate(check.action);
                  if (result?.mock) {
                    Alert.alert(
                      check.actionLabel,
                      `The JS mock cannot open settings.\n\nOn a device this opens: ${check.action}`
                    );
                  }
                  return result;
                })
              }
            />
          )) ?? <Text style={{ color: theme.muted }}>Loading…</Text>}

          {diagnostics?.device && (
            <Text style={[styles.deviceLine, { color: theme.muted }]}>
              {diagnostics.device.model} · {diagnostics.device.platform} {diagnostics.device.osVersion}
            </Text>
          )}
        </Section>

        {/* --- Dev panel: hidden, ships in production ----------------------- */}

        {devPanel && (
          <>
            <Section title="Dev · scenarios" theme={theme}>
              <Text style={[styles.hint, { color: theme.muted }]}>
                Force a known-broken state so the diagnostics list can be
                exercised without hunting for a misbehaving handset.
              </Text>
              <View style={styles.wrap}>
                {scenarios.map(name => (
                  <Button
                    key={name}
                    label={name}
                    small
                    active={status?.scenario === name}
                    theme={theme}
                    onPress={() => run(name, () => Airfob.setScenario(name))}
                  />
                ))}
              </View>
            </Section>

            <Section title="Dev · log level" theme={theme}>
              <View style={styles.wrap}>
                {Airfob.LOG_LEVELS.map(level => (
                  <Button
                    key={level}
                    label={level}
                    small
                    active={Airfob.log.getLevel() === level}
                    theme={theme}
                    onPress={() =>
                      run(level, async () => {
                        Airfob.log.setLevel(level);
                      })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Dev · tools" theme={theme}>
              <Row>
                <Button
                  label="Reset RSSI"
                  small
                  busy={busy === "RSSI"}
                  theme={theme}
                  onPress={() => run("RSSI", () => Airfob.resetRssi())}
                />
                <Button
                  label="Unregister"
                  small
                  busy={busy === "Unregister"}
                  theme={theme}
                  onPress={() => run("Unregister", () => Airfob.unregister())}
                />
              </Row>
              <Row>
                <Button
                  label="Export bundle"
                  small
                  busy={busy === "Export"}
                  theme={theme}
                  onPress={() =>
                    run("Export", async () => {
                      const bundle = await Airfob.log.export({ source: "example-app" });
                      Alert.alert(
                        "Support bundle",
                        bundle.path
                          ? `${bundle.content.entryCount} entries written to\n${bundle.path}`
                          : `${bundle.content.entryCount} entries held in memory (no native module to write a file)`
                      );
                      return bundle;
                    })
                  }
                />
                <Button
                  label="Clear log"
                  small
                  busy={busy === "Clear"}
                  theme={theme}
                  onPress={() => run("Clear", () => Airfob.log.clear())}
                />
              </Row>
            </Section>

            {rawState && (
              <Section title="Dev · raw state" theme={theme}>
                {Object.entries(rawState).map(([key, value]) => (
                  <Text key={key} style={[styles.mono, { color: theme.muted }]}>
                    {`${key.padEnd(20)} ${String(value)}`}
                  </Text>
                ))}
              </Section>
            )}

            {lastEvent && (
              <Section title="Dev · last event" theme={theme}>
                <Text style={[styles.mono, { color: theme.muted }]}>
                  {JSON.stringify(lastEvent, null, 2)}
                </Text>
              </Section>
            )}

            <Section title={`Dev · log (${entries.length})`} theme={theme}>
              {entries.map((entry, index) => (
                <Text key={`${entry.ts}-${index}`} style={[styles.mono, { color: theme.muted }]}>
                  <Text style={{ color: logColour(entry.lvl) }}>
                    {entry.lvl.toUpperCase().padEnd(5)}
                  </Text>
                  {` ${entry.src}/${entry.code}  ${entry.msg}`}
                </Text>
              ))}
            </Section>
          </>
        )}

        {!devPanel && (
          <Text style={[styles.footer, { color: theme.muted }]}>
            Long-press the version line for the dev panel.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- pieces --- */

/**
 * One diagnostic. The remediation button is the whole point: naming a problem
 * without offering the fix is what generates support calls.
 */
function CheckRow({ check, theme, busy, onRemediate }) {
  return (
    <View style={styles.check}>
      <View style={[styles.dot, { backgroundColor: STATE_COLOURS[check.state] }]} />
      <View style={styles.checkText}>
        <Text style={[styles.checkLabel, { color: theme.fg }]}>{check.label}</Text>
        <Text style={[styles.checkDetail, { color: theme.muted }]}>{check.detail}</Text>

        {/* Shown alongside the button too — on iOS the button only reaches the
            app settings page, so the user still needs telling what to do. */}
        {check.remedy && (
          <Text style={[styles.remedy, { color: theme.muted }]}>{check.remedy}</Text>
        )}

        {check.action && (
          <TouchableOpacity
            style={[styles.remediate, { borderColor: theme.accent }]}
            onPress={onRemediate}
            disabled={!!busy}
          >
            <Text style={[styles.remediateLabel, { color: theme.accent }]}>
              {busy ? "…" : check.actionLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function Section({ title, children, theme }) {
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.fg }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }) {
  return <View style={styles.row}>{children}</View>;
}

function Button({ label, onPress, busy, small, active, theme }) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: active ? theme.accent : theme.button, borderColor: theme.border }
      ]}
      onPress={onPress}
      disabled={!!busy}
    >
      <Text style={[styles.buttonLabel, { color: active ? "#fff" : theme.fg }]}>
        {busy ? "…" : label}
      </Text>
    </TouchableOpacity>
  );
}

const logColour = level =>
  level === "error" ? STATE_COLOURS.fail : level === "warn" ? STATE_COLOURS.warn : STATE_COLOURS.pass;

/* --------------------------------------------------------------- styling -- */

const lightTheme = {
  bg: "#ffffff", fg: "#1f2328", muted: "#57606a",
  border: "#d0d7de", button: "#f6f8fa", accent: "#0969da"
};

const darkTheme = {
  bg: "#0d1117", fg: "#e6edf3", muted: "#8b949e",
  border: "#30363d", button: "#21262d", accent: "#1f6feb"
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2, marginBottom: 16, paddingVertical: 4 },
  section: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginBottom: 10 },
  big: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  row: { flexDirection: "row", gap: 8, marginBottom: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    flex: 1, borderWidth: 1, borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 12, alignItems: "center"
  },
  buttonSmall: { flex: 0, paddingVertical: 6, paddingHorizontal: 10 },
  buttonLabel: { fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 12, marginBottom: 10, lineHeight: 17 },
  check: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
  checkText: { flex: 1 },
  checkLabel: { fontSize: 14, fontWeight: "500" },
  checkDetail: { fontSize: 12, marginTop: 1 },
  remedy: { fontSize: 12, marginTop: 4, lineHeight: 17, fontStyle: "italic" },
  remediate: {
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 6,
    paddingVertical: 5, paddingHorizontal: 10, marginTop: 6
  },
  remediateLabel: { fontSize: 12, fontWeight: "600" },
  deviceLine: { fontSize: 11, marginTop: 4 },
  footer: { fontSize: 11, textAlign: "center", marginTop: 8 },
  mono: { fontFamily: "Menlo", fontSize: 10, lineHeight: 15 }
});
