import Foundation
import UIKit

/// Turns a failing diagnostic into a tap that fixes it — as far as iOS allows.
///
/// **This is where iOS and Android diverge sharply.** Android can deep-link to
/// the exact settings screen for Bluetooth, location, notifications, or battery
/// optimisation. iOS offers exactly one public destination:
/// `UIApplication.openSettingsURLString`, this app's own settings page.
///
/// The `App-Prefs:root=Bluetooth` style URLs that circulate are private API. They
/// work in development and get apps rejected at review, so they are not used
/// here. Every action id therefore lands on the same screen, and the difference
/// is carried by the guidance text in the check's `remedy` field.
///
/// Practical consequence: iOS diagnostics must *say more*, because they can *do*
/// less. Keep the remedy strings specific — "Settings > Bluetooth", not
/// "check your settings".
enum AirfobRemediation {

    // Shared with Android and the JS layer so one Mendix page renders either.
    static let openBluetooth = "openBluetoothSettings"
    static let openAppSettings = "openAppSettings"
    static let openLocation = "openLocationSettings"
    static let openNotifications = "openNotificationSettings"
    static let openBattery = "openBatterySettings"
    static let requestBatteryExemption = "requestBatteryExemption"

    private static let known: Set<String> = [
        openBluetooth, openAppSettings, openLocation,
        openNotifications, openBattery, requestBatteryExemption
    ]

    /// - Returns: true when a settings screen was opened.
    /// - Throws: `AirfobError` for an unknown id, so callers surface it rather
    ///   than leaving a dead button.
    @discardableResult
    static func run(_ actionId: String) throws -> Bool {
        guard known.contains(actionId) else {
            throw AirfobError("E_SDK", "Unknown remediation action \"\(actionId)\"")
        }

        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            throw AirfobError("E_SDK", "Settings URL is unavailable")
        }

        // Battery optimisation has no iOS equivalent at all — Low Power Mode is
        // system-wide and cannot be exempted per app. Say so rather than opening
        // a settings page that has nothing relevant on it.
        if actionId == openBattery || actionId == requestBatteryExemption {
            AirfobLog.shared.write(
                "info", "perm", "REMEDIATE_NOOP",
                "No per-app battery exemption exists on iOS"
            )
            throw AirfobError(
                "E_SDK",
                "iOS has no per-app battery exemption. Ask the user to turn off Low Power Mode."
            )
        }

        var opened = false
        let semaphore = DispatchSemaphore(value: 0)

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                opened = success
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 3)

        AirfobLog.shared.write(
            opened ? "info" : "error",
            "perm",
            opened ? "REMEDIATE" : "REMEDIATE_FAIL",
            opened ? "Opened app settings for \(actionId)" : "Could not open settings"
        )

        return opened
    }
}
