/// Minimal stand-in for the React module, built into a `React.swiftmodule` so
/// `import React` resolves during a type-check.
///
/// WHY A SHIM
///   The real React-Core is an Objective-C pod. Resolving it means a Podfile, a
///   generated Xcode project, and `pod install` pulling Yoga, RCT-Folly and glog
///   — several minutes and a lot of moving parts for what is meant to be a fast
///   gate. Only AirfobModule.swift imports React; the other four files compile
///   against the genuine iOS SDK with nothing faked.
///
/// WHAT THIS MEANS
///   React API misuse is NOT caught here — these declarations are ours, so they
///   agree with our code by construction. Everything else is real: UIKit,
///   CoreBluetooth, Foundation, UserNotifications and os.log all come from the
///   iOS SDK on the runner.
///
///   Keep these signatures matching React Native's actual headers. When they
///   drift, this stops being a check and starts being a rubber stamp.
import Foundation

public typealias RCTPromiseResolveBlock = (Any?) -> Void
public typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void

/// Mirrors RCTEventEmitter.h — only the members this package uses.
open class RCTEventEmitter: NSObject {
    public override init() {
        super.init()
    }

    open func supportedEvents() -> [String] {
        []
    }

    open func startObserving() {}

    open func stopObserving() {}

    open func sendEvent(withName name: String, body: Any?) {}

    open class func requiresMainQueueSetup() -> Bool {
        false
    }

    open func invalidate() {}
}
