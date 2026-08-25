import CoreBluetooth
import Foundation
import UIKit
import UserNotifications

/// Every precondition that has to hold before a tap can open a door, evaluated
/// against the platform rather than the SDK. Deliberately SDK-free so it works
/// in P1 and tells you the truth even when the SDK itself is broken.
///
/// Mirrors AirfobDiagnostics.kt. Check ids match across platforms so one Mendix
/// page renders either — but the `remedy` strings are deliberately wordier here,
/// because iOS cannot deep-link to a specific settings pane the way Android can.
/// See AirfobRemediation.swift.
final class AirfobDiagnostics: NSObject, CBCentralManagerDelegate {

    static let shared = AirfobDiagnostics()

    struct Check {
        let id: String
        let label: String
        let state: String   // pass | fail | warn | unknown
        let detail: String
        var action: String?
        var actionLabel: String?
        var remedy: String?

        var asDictionary: [String: Any] {
            [
                "id": id,
                "label": label,
                "state": state,
                "detail": detail,
                "action": action as Any,
                "actionLabel": actionLabel as Any,
                "remedy": remedy as Any
            ]
        }
    }

    /// Held only to read authorization/power state. Never used for scanning —
    /// that is the SDK's job.
    private lazy var central: CBCentralManager = {
        // showPowerAlert false: diagnostics must observe, not nag.
        CBCentralManager(delegate: self, queue: nil, options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }()

    private var notificationsAuthorized: Bool?

    override init() {
        super.init()
        _ = central
        refreshNotificationAuthorization()
    }

    func bluetoothState() -> String {
        switch central.state {
        case .poweredOn: return "on"
        case .poweredOff: return "off"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        default: return "unknown"
        }
    }

    func permissionsState() -> String {
        if #available(iOS 13.1, *) {
            switch CBCentralManager.authorization {
            case .allowedAlways: return "granted"
            case .denied, .restricted: return "denied"
            case .notDetermined: return "partial"
            @unknown default: return "partial"
            }
        }
        return central.state == .unauthorized ? "denied" : "granted"
    }

    func run(sdk: AirfobSdk, mock: Bool) -> [Check] {
        var checks: [Check] = []

        let bt = bluetoothState()
        checks.append(Check(
            id: "bluetooth",
            label: "Bluetooth enabled",
            state: bt == "on" ? "pass" : "fail",
            detail: bt,
            action: nil,
            actionLabel: nil,
            // No deep link exists; Control Centre is faster than Settings anyway.
            remedy: bt == "off"
                ? "Turn Bluetooth on from Control Centre, or Settings > Bluetooth."
                : (bt == "unsupported" ? "This device has no Bluetooth LE radio." : nil)
        ))

        let permissions = permissionsState()
        checks.append(Check(
            id: "permissions",
            label: "Bluetooth permission granted",
            state: permissions == "granted" ? "pass" : "fail",
            detail: permissions,
            action: permissions == "granted" ? nil : AirfobRemediation.openAppSettings,
            actionLabel: permissions == "granted" ? nil : "Open app settings",
            remedy: permissions == "granted" ? nil : "Turn on Bluetooth for this app."
        ))

        // Without the bluetooth-central background mode the OS will not relaunch
        // the app for a reader, so tap-and-go silently stops working once the app
        // is swiped away. Worth catching at build time, not in the field.
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        let hasCentral = modes.contains("bluetooth-central")
        checks.append(Check(
            id: "backgroundMode",
            label: "Background Bluetooth enabled",
            state: hasCentral ? "pass" : "fail",
            detail: hasCentral ? "bluetooth-central" : "UIBackgroundModes is missing bluetooth-central",
            action: nil,
            actionLabel: nil,
            // A build defect, not a user problem — say so plainly.
            remedy: hasCentral ? nil
                : "Build configuration issue: add bluetooth-central to UIBackgroundModes."
        ))

        if let authorized = notificationsAuthorized {
            checks.append(Check(
                id: "notifications",
                label: "Notification permission",
                state: authorized ? "pass" : "warn",
                detail: authorized ? "granted" : "denied — unlock feedback will be silent",
                action: authorized ? nil : AirfobRemediation.openNotifications,
                actionLabel: authorized ? nil : "Open app settings",
                remedy: authorized ? nil : "Turn on Notifications for this app."
            ))
        }

        let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        checks.append(Check(
            id: "battery",
            label: "Low Power Mode off",
            state: lowPower ? "warn" : "pass",
            detail: lowPower ? "on — the OS may throttle background scanning" : "off",
            action: nil,
            actionLabel: nil,
            // iOS has no per-app exemption; Low Power Mode is system-wide.
            remedy: lowPower ? "Turn off Low Power Mode in Settings > Battery." : nil
        ))

        let status = sdk.status()
        checks.append(Check(
            id: "credential",
            label: "Credential present",
            state: status.registered ? "pass" : "fail",
            detail: "\(status.cardCount) card(s)",
            action: nil,
            actionLabel: nil,
            remedy: status.registered ? nil : "Activate your access from the home screen."
        ))

        let cards = sdk.cards()
        let allActive = !cards.isEmpty && cards.allSatisfy { $0.status == "active" }
        checks.append(Check(
            id: "credentialStatus",
            label: "Credential active",
            state: allActive ? "pass" : "fail",
            detail: cards.isEmpty ? "none" : cards.map { $0.status }.joined(separator: ", "),
            action: nil,
            actionLabel: nil,
            remedy: allActive ? nil
                : "Your access has been suspended or has expired. Contact your administrator."
        ))

        checks.append(Check(
            id: "licence",
            label: "SDK licence valid",
            state: status.licence == "valid" ? "pass" : (status.licence == "unknown" ? "unknown" : "fail"),
            detail: status.licence,
            action: nil,
            actionLabel: nil,
            // Nothing the user can do — this one is on the operator.
            remedy: status.licence == "valid" ? nil
                : "The Airfob licence for this app has expired. This needs an administrator."
        ))

        checks.append(Check(
            id: "native",
            label: "Native SDK linked",
            state: mock ? "warn" : "pass",
            detail: mock ? "Running MockAirfobSdk — no Airfob SDK in this build" : "linked",
            action: nil,
            actionLabel: nil,
            remedy: mock ? "Expected in Make It Native and in builds made before P5." : nil
        ))

        return checks
    }

    func device() -> [String: String] {
        [
            "platform": "ios",
            "model": UIDevice.current.model,
            "osVersion": UIDevice.current.systemVersion
        ]
    }

    /// Raw state for a support bundle. Deliberately verbose.
    func rawState(sdk: AirfobSdk, mock: Bool) -> [String: Any] {
        let status = sdk.status()
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        return [
            "platform": "ios",
            "bundleId": Bundle.main.bundleIdentifier ?? "unknown",
            "model": UIDevice.current.model,
            "osVersion": UIDevice.current.systemVersion,
            "mock": mock,
            "sdkReady": status.sdkReady,
            "registered": status.registered,
            "cardCount": status.cardCount,
            "licence": status.licence,
            "bluetooth": bluetoothState(),
            "permissions": permissionsState(),
            "backgroundModes": modes.joined(separator: ", "),
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "logLevel": AirfobLog.shared.getLevel()
        ]
    }

    private func refreshNotificationAuthorization() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            self?.notificationsAuthorized = settings.authorizationStatus == .authorized
        }
    }

    // MARK: - CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        AirfobLog.shared.write("debug", "ble", "STATE", "Central manager state: \(bluetoothState())")
    }
}
