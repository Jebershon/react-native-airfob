import Foundation
import React

/// React Native module "Airfob".
///
/// Translates between JS dictionaries and Swift, and nothing else. It holds no
/// state and makes no SDK calls of its own — the SDK lives in AirfobCore so it
/// outlives the JS layer.
@objc(Airfob)
final class Airfob: RCTEventEmitter {

    private static let eventName = "airfob"

    private var hasListeners = false
    private var sdk: AirfobSdk { AirfobCore.shared.sdk() }

    override init() {
        super.init()
        AirfobCore.shared.setEmitter { [weak self] name, data in
            self?.emit(name: name, data: data)
        }
    }

    deinit {
        AirfobCore.shared.setEmitter(nil)
    }

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String] { [Airfob.eventName] }

    override func startObserving() { hasListeners = true }

    override func stopObserving() { hasListeners = false }

    // MARK: - commands

    @objc(boot:resolver:rejecter:)
    func boot(_ options: [String: Any],
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let level = options["logLevel"] as? String { AirfobLog.shared.setLevel(level) }
        AirfobCore.shared.boot(config: options)
        resolve([
            "sdkReady": sdk.status().sdkReady,
            "mock": AirfobCore.shared.isMock
        ])
    }

    @objc(getStatus:rejecter:)
    func getStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(statusDictionary())
    }

    @objc(register:resolver:rejecter:)
    func register(_ options: [String: Any],
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let token = options["token"] as? String, !token.isEmpty else {
            return fail(reject, AirfobError("E_SDK", "register requires a token"))
        }
        guarded(resolve, reject) { ["cards": try self.sdk.register(token: token).map { $0.asDictionary }] }
    }

    @objc(getCards:rejecter:)
    func getCards(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["cards": sdk.cards().map { $0.asDictionary }])
    }

    @objc(unregister:resolver:rejecter:)
    func unregister(_ options: [String: Any],
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        guarded(resolve, reject) {
            ["cards": try self.sdk.unregister(cardId: options["cardId"] as? String).map { $0.asDictionary }]
        }
    }

    /// Manual unlock. Tap-and-go never reaches here — the SDK opens the door on
    /// proximity with no JS involved. Bluetooth is re-checked because the user
    /// can turn it off between page load and button press.
    @objc(unlock:resolver:rejecter:)
    func unlock(_ options: [String: Any],
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
        let bt = AirfobDiagnostics.shared.bluetoothState()
        guard bt == "on" else {
            return fail(reject, AirfobError("E_BT_OFF", "Bluetooth is \(bt)"))
        }
        guard AirfobDiagnostics.shared.permissionsState() == "granted" else {
            return fail(reject, AirfobError("E_PERMISSION", "Bluetooth permission not granted"))
        }
        guarded(resolve, reject) {
            ["result": try self.sdk.unlock(cardId: options["cardId"] as? String)]
        }
    }

    @objc(getDiagnostics:rejecter:)
    func getDiagnostics(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let checks = AirfobDiagnostics.shared.run(sdk: sdk, mock: AirfobCore.shared.isMock)
        resolve([
            "checks": checks.map { $0.asDictionary },
            "summary": checks.contains { $0.state == "fail" } ? "fail" : "pass",
            "device": AirfobDiagnostics.shared.device()
        ])
    }

    /// Opens the settings screen that fixes a failing check. On iOS that is
    /// always this app's own settings page — see AirfobRemediation.
    @objc(remediate:resolver:rejecter:)
    func remediate(_ actionId: String,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guarded(resolve, reject) { ["opened": try AirfobRemediation.run(actionId)] }
    }

    /// Verbose internal state for a support bundle or the dev panel.
    @objc(getRawState:rejecter:)
    func getRawState(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(AirfobDiagnostics.shared.rawState(sdk: sdk, mock: AirfobCore.shared.isMock))
    }

    /// First thing to try when one specific door starts refusing taps.
    @objc(resetRssi:rejecter:)
    func resetRssi(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guarded(resolve, reject) {
            try self.sdk.resetRssi()
            return ["reset": true]
        }
    }

    /// iOS has no runtime Bluetooth prompt to trigger on demand — the system asks
    /// the first time a central manager is created. Report state instead.
    @objc(requestPermissions:rejecter:)
    func requestPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        let state = AirfobDiagnostics.shared.permissionsState()
        resolve([
            "granted": state == "granted",
            "missing": state == "granted" ? [] : ["bluetooth"]
        ])
    }

    // MARK: - log

    @objc(logWrite:resolver:rejecter:)
    func logWrite(_ entry: [String: Any],
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        AirfobLog.shared.writeRaw(entry)
        resolve([:])
    }

    @objc(logSetLevel:resolver:rejecter:)
    func logSetLevel(_ level: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        AirfobLog.shared.setLevel(level)
        resolve(["level": AirfobLog.shared.getLevel()])
    }

    @objc(logSetRetention:resolver:rejecter:)
    func logSetRetention(_ days: NSNumber,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        AirfobLog.shared.setRetention(days.doubleValue)
        resolve(["retentionDays": AirfobLog.shared.getRetention()])
    }

    @objc(logGet:resolver:rejecter:)
    func logGet(_ options: [String: Any],
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["entries": AirfobLog.shared.entries(since: options["since"] as? String)])
    }

    @objc(logClear:rejecter:)
    func logClear(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        AirfobLog.shared.clear()
        resolve([:])
    }

    @objc(logExport:resolver:rejecter:)
    func logExport(_ json: String,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let path = AirfobLog.shared.exportBundle(json) else {
            return fail(reject, AirfobError("E_SDK", "Could not write the support bundle"))
        }
        AirfobLog.shared.write("info", "bridge", "EXPORT", "Support bundle written")
        resolve(["path": path])
    }

    // MARK: - utils

    private func emit(name: String, data: [String: Any]) {
        guard hasListeners else { return }
        var payload = data
        payload["name"] = name
        sendEvent(withName: Airfob.eventName, body: payload)
    }

    private func statusDictionary() -> [String: Any] {
        let s = sdk.status()
        return [
            "sdkReady": s.sdkReady,
            "mock": AirfobCore.shared.isMock,
            "registered": s.registered,
            "bluetooth": AirfobDiagnostics.shared.bluetoothState(),
            "permissions": AirfobDiagnostics.shared.permissionsState(),
            "licence": s.licence,
            "cardCount": s.cardCount
        ]
    }

    private func guarded(_ resolve: @escaping RCTPromiseResolveBlock,
                         _ reject: @escaping RCTPromiseRejectBlock,
                         _ block: () throws -> Any) {
        do {
            resolve(try block())
        } catch let error as AirfobError {
            fail(reject, error)
        } catch {
            let wrapped = AirfobError("E_SDK", error.localizedDescription)
            AirfobLog.shared.write("error", "bridge", wrapped.code, wrapped.message)
            reject(wrapped.code, wrapped.message, error)
        }
    }

    private func fail(_ reject: @escaping RCTPromiseRejectBlock, _ error: AirfobError) {
        AirfobLog.shared.write("error", "bridge", error.code, error.message)
        reject(error.code, error.message, nil)
    }
}
