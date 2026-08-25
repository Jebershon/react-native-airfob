import Foundation

/// The single seam between this package and MOCA System's Airfob SDK.
/// Nothing outside this file imports a MOCA symbol, which is what makes P1
/// shippable without a licence.

public struct AirfobCard {
    public let id: String
    public let name: String
    public let siteName: String
    public let status: String
    public let accessLevels: [String]

    public var asDictionary: [String: Any] {
        [
            "id": id,
            "name": name,
            "siteName": siteName,
            "status": status,
            "accessLevels": accessLevels
        ]
    }
}

public struct AirfobSdkStatus {
    public let sdkReady: Bool
    public let registered: Bool
    public let licence: String
    public let cardCount: Int
}

public struct AirfobError: Error {
    public let code: String
    public let message: String

    public init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }
}

public typealias SdkEmitter = (String, [String: Any]) -> Void

public protocol AirfobSdk {
    /// Called at launch. Must be cheap and must not throw when unenrolled.
    func boot(config: [String: Any]) throws
    func status() -> AirfobSdkStatus
    func register(token: String) throws -> [AirfobCard]
    func cards() -> [AirfobCard]
    /// Returns "opened" | "noReader" | "denied"
    func unlock(cardId: String?) throws -> String
    func unregister(cardId: String?) throws -> [AirfobCard]

    /// Clears cached per-reader RSSI values. The SDK learns a signal baseline per
    /// reader; when a reader is moved or replaced that baseline goes stale and
    /// taps start failing at the old distance. MOCA added an API for this in
    /// 2.3.15 — it is the first thing to try when one door goes bad.
    func resetRssi() throws

    func teardown()
}

// MARK: - mock

/// Behaves like the real thing minus the radio. Credentials persist across
/// launches so the enrolment flow can be tested properly.
public final class MockAirfobSdk: AirfobSdk {

    private let emit: SdkEmitter
    private let defaults = UserDefaults.standard
    private let storageKey = "airfob.mock.cardId"

    private var ready = false
    private var stored: [AirfobCard] = []

    public init(emit: @escaping SdkEmitter) {
        self.emit = emit
    }

    public func boot(config: [String: Any]) throws {
        ready = true
        restore()
        AirfobLog.shared.write(
            "info", "sdk", "BOOT",
            "Mock SDK booted with \(stored.count) credential(s)",
            data: ["siteId": config["siteId"] as? String ?? "none"]
        )
        emit("status", ["status": statusDictionary()])
    }

    public func status() -> AirfobSdkStatus {
        AirfobSdkStatus(
            sdkReady: ready,
            registered: !stored.isEmpty,
            licence: "valid",
            cardCount: stored.count
        )
    }

    public func register(token: String) throws -> [AirfobCard] {
        guard ready else { throw AirfobError("E_NOT_READY", "boot() has not been called") }

        stored = [
            AirfobCard(
                id: "mock-" + String(token.prefix(8)),
                name: "Mock Credential",
                siteName: "Mock Site",
                status: "active",
                accessLevels: ["All doors"]
            )
        ]
        persist()
        AirfobLog.shared.write("info", "sdk", "REGISTER", "Registered \(stored.count) credential(s)")
        emit("status", ["status": statusDictionary()])
        return stored
    }

    public func cards() -> [AirfobCard] { stored }

    public func unlock(cardId: String?) throws -> String {
        guard ready else { throw AirfobError("E_NOT_READY", "boot() has not been called") }
        guard !stored.isEmpty else { throw AirfobError("E_NO_CARD", "No credential registered") }

        let rssi = -62
        AirfobLog.shared.write(
            "info", "ble", "UNLOCK", "Door opened",
            data: ["cardId": cardId ?? stored[0].id, "rssi": rssi]
        )
        emit("unlockResult", ["result": "opened", "readerId": "mock-reader", "rssi": rssi])
        return "opened"
    }

    public func unregister(cardId: String?) throws -> [AirfobCard] {
        stored.removeAll()
        persist()
        AirfobLog.shared.write("info", "sdk", "UNREGISTER", "Credentials cleared")
        emit("status", ["status": statusDictionary()])
        return stored
    }

    public func resetRssi() throws {
        AirfobLog.shared.write("info", "ble", "RSSI_RESET", "Cached reader RSSI values cleared")
    }

    public func teardown() { ready = false }

    private func statusDictionary() -> [String: Any] {
        let s = status()
        return [
            "sdkReady": s.sdkReady,
            "registered": s.registered,
            "licence": s.licence,
            "cardCount": s.cardCount
        ]
    }

    private func persist() {
        defaults.set(stored.first?.id, forKey: storageKey)
    }

    private func restore() {
        guard let id = defaults.string(forKey: storageKey) else { return }
        stored = [AirfobCard(id: id, name: "Mock Credential", siteName: "Mock Site",
                             status: "active", accessLevels: ["All doors"])]
    }
}

// MARK: - core

/// Process-wide owner of the SDK instance.
///
/// Exists for one reason: tap-and-go must work while the app is closed. If the
/// SDK were created by the React Native module it would only live as long as the
/// JS layer, which is almost never at the moment a user holds their phone to a
/// reader. So the SDK is started at launch and the RN module attaches to it.
@objc(AirfobCore)
public final class AirfobCore: NSObject {

    @objc public static let shared = AirfobCore()

    private var sdkInstance: AirfobSdk?
    private var emitter: SdkEmitter?
    private var booted = false
    private let lock = NSLock()

    /// Real adapter when the licensed framework is vendored, mock otherwise.
    ///
    /// AIRFOB_SDK is set by the podspec, which switches it on only when an
    /// .xcframework is present in ios/Frameworks — so there is no source edit to
    /// remember, and a build without a licence still compiles.
    private func create() -> AirfobSdk {
        let emitter: SdkEmitter = { [weak self] name, data in self?.dispatch(name, data) }
        #if AIRFOB_SDK
        AirfobLog.shared.write("info", "sdk", "ADAPTER", "Using RealAirfobSdk")
        return RealAirfobSdk(emit: emitter)
        #else
        AirfobLog.shared.write("info", "sdk", "ADAPTER", "No Airfob SDK in this build — using MockAirfobSdk")
        return MockAirfobSdk(emit: emitter)
        #endif
    }

    @objc public var isMock: Bool {
        sdk() is MockAirfobSdk
    }

    public func sdk() -> AirfobSdk {
        lock.lock()
        defer { lock.unlock() }
        if let existing = sdkInstance { return existing }
        let created = create()
        sdkInstance = created
        return created
    }

    /// Called at launch. Guarded so an unenrolled device does nothing expensive:
    /// no scanning, no background mode, no battery cost.
    @objc public func bootIfEnrolled() {
        AirfobLog.shared.attach()
        AirfobLog.shared.write("info", "service", "PROCESS_START", "Airfob core attached")

        guard !sdk().cards().isEmpty else {
            AirfobLog.shared.write(
                "info", "service", "BOOT_SKIP",
                "No credential on this device — not starting the scanner"
            )
            return
        }
        boot(config: [:])
    }

    public func boot(config: [String: Any]) {
        lock.lock()
        let alreadyBooted = booted
        lock.unlock()
        guard !alreadyBooted else { return }

        do {
            try sdk().boot(config: config)
            lock.lock(); booted = true; lock.unlock()
            AirfobLog.shared.write("info", "service", "BOOT", "Scanner started")
        } catch {
            let message = (error as? AirfobError)?.message ?? error.localizedDescription
            AirfobLog.shared.write("error", "service", "BOOT_FAIL", message)
        }
    }

    /// The RN module registers itself here; before that, events go to the log only.
    public func setEmitter(_ next: SdkEmitter?) {
        emitter = next
    }

    private func dispatch(_ name: String, _ data: [String: Any]) {
        if let emitter = emitter {
            emitter(name, data)
        } else {
            AirfobLog.shared.write("debug", "sdk", "EVENT_DROPPED", "No JS listener for \"\(name)\"")
        }
    }
}
