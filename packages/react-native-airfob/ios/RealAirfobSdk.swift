import Foundation

// The real Airfob adapter — the ONLY file in this package that may import MOCA
// System symbols.
//
// AIRFOB_SDK is set by the podspec, which switches it on only when an
// .xcframework is present in ios/Frameworks. Without a licence this file
// compiles to nothing, which is what keeps CI green and lets the package ship
// against the mock.
#if AIRFOB_SDK

// TODO(P5): import MOCA's module. The name comes from the framework they ship —
//   it is not published on developers.airfob.com, which is a download and
//   changelog page only.
// import AirfobSDK

/// ## What you need before starting
///
///  - the licensed iOS framework in ios/Frameworks/
///  - MOCA's SDK reference, which ships inside the gated archive
///  - a site id and API key from an Airfob tenant
///  - a physical reader on a desk. BLE unlock cannot be tested any other way.
///
/// ## The contract you are implementing
///
/// Everything above this file already depends on these behaviours, and the JS
/// test suite asserts them against the mock. Match them exactly or the Mendix
/// pages will misreport.
///
/// | method    | must                                                          |
/// |-----------|---------------------------------------------------------------|
/// | boot      | be cheap, and NOT throw on an unenrolled device                |
/// | status    | report licence "expired" rather than failing unlock opaquely   |
/// | register  | throw AirfobError("E_NOT_READY") if boot has not run           |
/// | unlock    | throw AirfobError("E_NO_CARD") when no credential is present   |
/// | unlock    | return "opened" / "noReader" / "denied", never throw for those |
/// | resetRssi | clear cached per-reader baselines                              |
///
/// Emit events as they happen — do not batch:
///   emit("unlockResult", ["result": ..., "readerId": ..., "rssi": ...])
///   emit("readerDetected", ["readerId": ..., "rssi": ...])
///   emit("status", ["status": <same shape as MockAirfobSdk.statusDictionary>])
///
/// Log through AirfobLog so entries land in the same support bundle:
///   AirfobLog.shared.write("info", "ble", "UNLOCK", "Door opened", data: ["rssi": rssi])
///
/// ## iOS specifics that will bite
///
///  - The app must declare the `bluetooth-central` background mode, or the OS
///    will not relaunch it for a reader and tap-and-go silently stops working
///    once the app is swiped away. AirfobDiagnostics already checks for this.
///  - CoreBluetooth state restoration is what brings the app back. `boot` has to
///    run early enough for the system to hand back a restored central manager,
///    which is why AirfobBootstrap starts the core at
///    UIApplicationDidFinishLaunching rather than from JavaScript.
///  - Info.plist needs NSBluetoothAlwaysUsageDescription. App Review rejects
///    builds without it.
///  - There is no per-app battery exemption on iOS. Low Power Mode throttles
///    background scanning and nothing in the app can opt out.
public final class RealAirfobSdk: AirfobSdk {

    private let emit: SdkEmitter

    public init(emit: @escaping SdkEmitter) {
        self.emit = emit
    }

    private func notImplemented(_ method: String) -> AirfobError {
        AirfobError(
            "E_NOT_READY",
            "RealAirfobSdk.\(method) is not implemented — see docs/P5-INTEGRATION.md"
        )
    }

    public func boot(config: [String: Any]) throws {
        // TODO(P5): initialise the MOCA SDK with config["siteId"] / config["apiKey"]
        //   and register the callback that forwards reader detection and unlock
        //   results through emit().
        throw notImplemented("boot")
    }

    public func status() -> AirfobSdkStatus {
        // TODO(P5): read SDK readiness, registered card count, and licence state.
        AirfobSdkStatus(sdkReady: false, registered: false, licence: "unknown", cardCount: 0)
    }

    public func register(token: String) throws -> [AirfobCard] {
        // TODO(P5): hand `token` — issued by your backend against the Airfob API —
        //   to the SDK's card registration call, then map the result to AirfobCard.
        throw notImplemented("register")
    }

    public func cards() -> [AirfobCard] {
        // TODO(P5): list credentials held on this device.
        []
    }

    public func unlock(cardId: String?) throws -> String {
        // TODO(P5): trigger the SDK's open-door call. Return the outcome rather
        //   than throwing for noReader/denied — those are results, not errors.
        throw notImplemented("unlock")
    }

    public func unregister(cardId: String?) throws -> [AirfobCard] {
        // TODO(P5): delete the credential from this device. Test this properly —
        //   offboarding is the path that gets skipped and matters most.
        throw notImplemented("unregister")
    }

    public func resetRssi() throws {
        // TODO(P5): call the SDK's RSSI reset.
        throw notImplemented("resetRssi")
    }

    public func teardown() {
        // TODO(P5): stop scanning and release the SDK.
    }
}

#endif
