import Foundation
import os.log

/// Bounded, disk-backed structured log. Mirrors AirfobLog.kt exactly — same
/// JSONL format, same levels, same sources — so a support bundle from either
/// platform reads identically.
///
/// Two properties drive the design:
///  1. It survives process death. The tap that failed happened hours before the
///     user opened the app to complain.
///  2. It is bounded. Access logs on a daily-use device are personal data and
///     would otherwise grow without limit.
///
/// Live tailing: filter Console.app on subsystem `com.airfob`.
@objc(AirfobLog)
public final class AirfobLog: NSObject {

    @objc public static let shared = AirfobLog()

    private static let ringCapacity = 500
    private static let maxFileBytes: UInt64 = 1_000_000
    private static let fileName = "airfob-log.jsonl"
    private static let rotatedName = "airfob-log.1.jsonl"

    private static let levels: [String: Int] = [
        "off": 0, "error": 1, "warn": 2, "info": 3, "debug": 4
    ]

    private let osLog = OSLog(subsystem: "com.airfob", category: "airfob")
    private let queue = DispatchQueue(label: "com.airfob.log")

    private var ring: [[String: Any]] = []
    private var level = "info"

    /// Days of history kept. Access logs record where a named person was and when,
    /// which is personal data — this is a privacy control, not a disk-space one.
    /// 0 keeps everything and should only be set deliberately.
    private var retentionDays: Double = 7.0

    private lazy var formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    private var logURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(AirfobLog.fileName)
    }

    /// Called once at launch from AirfobCore. Replays whatever survived the last
    /// run so the ring is not empty when the app comes back up.
    @objc public func attach() {
        queue.async {
            self.loadTail()
            // Drop anything that aged out while the process was dead.
            self.pruneLocked()
        }
    }

    @objc public func setLevel(_ next: String) {
        guard AirfobLog.levels[next] != nil else { return }
        queue.async { self.level = next }
    }

    @objc public func getLevel() -> String {
        queue.sync { level }
    }

    @objc public func setRetention(_ days: Double) {
        queue.async {
            self.retentionDays = days < 0 ? 0 : days
            self.pruneLocked()
        }
    }

    @objc public func getRetention() -> Double {
        queue.sync { retentionDays }
    }

    /// Caller must already be running on the serial queue.
    private func pruneLocked() {
        guard retentionDays > 0 else { return }
        let cutoff = formatter.string(from: Date(timeIntervalSinceNow: -retentionDays * 86_400))
        while let first = ring.first, (first["ts"] as? String ?? "") < cutoff {
            ring.removeFirst()
        }
    }

    public func write(
        _ entryLevel: String,
        _ source: String,
        _ code: String,
        _ message: String,
        data: [String: Any]? = nil
    ) {
        let threshold = AirfobLog.levels[queue.sync { level }] ?? 3
        let incoming = AirfobLog.levels[entryLevel] ?? 3
        guard threshold != 0, incoming <= threshold else { return }

        var entry: [String: Any] = [
            "ts": formatter.string(from: Date()),
            "lvl": entryLevel,
            "src": source,
            "code": code,
            "msg": message
        ]
        if let data = data, !data.isEmpty { entry["data"] = data }

        switch entryLevel {
        case "error": os_log("[%{public}@/%{public}@] %{public}@", log: osLog, type: .error, source, code, message)
        case "debug": os_log("[%{public}@/%{public}@] %{public}@", log: osLog, type: .debug, source, code, message)
        default: os_log("[%{public}@/%{public}@] %{public}@", log: osLog, type: .info, source, code, message)
        }

        append(entry)
    }

    /// Accepts an entry already shaped by the JS side so both interleave.
    @objc public func writeRaw(_ entry: [String: Any]) {
        append(entry)
    }

    /// Newest last. `since` is an ISO timestamp.
    @objc public func entries(since: String?) -> [[String: Any]] {
        queue.sync {
            pruneLocked()
            guard let since = since else { return ring }
            return ring.filter { ($0["ts"] as? String ?? "") >= since }
        }
    }

    @objc public func clear() {
        queue.async {
            self.ring.removeAll()
            guard let url = self.logURL else { return }
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(
                at: url.deletingLastPathComponent().appendingPathComponent(AirfobLog.rotatedName)
            )
        }
    }

    /// Writes a support bundle to the caches directory and returns its path.
    @objc public func exportBundle(_ json: String) -> String? {
        guard let caches = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let url = caches.appendingPathComponent("airfob-support-\(Int(Date().timeIntervalSince1970)).json")
        do {
            try json.write(to: url, atomically: true, encoding: .utf8)
            return url.path
        } catch {
            os_log("Could not write support bundle: %{public}@", log: osLog, type: .error, error.localizedDescription)
            return nil
        }
    }

    // MARK: - io

    private func append(_ entry: [String: Any]) {
        queue.async {
            self.ring.append(entry)
            if self.ring.count > AirfobLog.ringCapacity {
                self.ring.removeFirst(self.ring.count - AirfobLog.ringCapacity)
            }
            self.appendToFile(entry)
            self.pruneLocked()
        }
    }

    private func appendToFile(_ entry: [String: Any]) {
        guard let url = logURL,
              let data = try? JSONSerialization.data(withJSONObject: entry),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"

        let fm = FileManager.default
        let dir = url.deletingLastPathComponent()
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)

        if let attrs = try? fm.attributesOfItem(atPath: url.path),
           let size = attrs[.size] as? UInt64, size > AirfobLog.maxFileBytes {
            let rotated = dir.appendingPathComponent(AirfobLog.rotatedName)
            try? fm.removeItem(at: rotated)
            try? fm.moveItem(at: url, to: rotated)
        }

        if fm.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }

    private func loadTail() {
        guard let url = logURL,
              let contents = try? String(contentsOf: url, encoding: .utf8) else { return }

        let lines = contents
            .split(separator: "\n")
            .suffix(AirfobLog.ringCapacity)

        ring = lines.compactMap { line in
            guard let data = line.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return nil }
            return object
        }
    }
}
