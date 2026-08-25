package com.airfob

import android.content.Context

/**
 * The real Airfob adapter — the ONLY file in this package that may import MOCA
 * System classes.
 *
 * This source set is compiled only when a licensed AAR is present in
 * android/libs/. Everything else builds and tests without it, which is why CI
 * stays green on machines that have no licence.
 *
 * ## What you need before starting
 *
 *  - the licensed Android AAR (2.5.38 or later) in android/libs/
 *  - MOCA's SDK reference, which ships inside the gated archive rather than on
 *    developers.airfob.com — that page is a download and changelog only
 *  - a site id and API key from an Airfob tenant
 *  - a physical reader on a desk. BLE unlock cannot be tested any other way.
 *
 * ## The contract you are implementing
 *
 * Everything above this file already depends on these behaviours, and the JS
 * test suite asserts them against the mock. Match them exactly or the Mendix
 * pages will misreport.
 *
 * | method       | must                                                        |
 * |--------------|-------------------------------------------------------------|
 * | boot         | be cheap, and NOT throw on an unenrolled device              |
 * | status       | report licence "expired" rather than failing unlock opaquely |
 * | register     | throw AirfobError("E_NOT_READY") if boot has not run         |
 * | unlock       | throw AirfobError("E_NO_CARD") when no credential is present |
 * | unlock       | return "opened" | "noReader" | "denied", never throw for those|
 * | resetRssi    | clear cached per-reader baselines                            |
 *
 * Emit events as they happen — do not batch:
 *   emit("unlockResult", mapOf("result" to ..., "readerId" to ..., "rssi" to ...))
 *   emit("readerDetected", mapOf("readerId" to ..., "rssi" to ...))
 *   emit("status", mapOf("status" to <same shape as statusMap in MockAirfobSdk>))
 *
 * Log through AirfobLog so entries land in the same support bundle as the rest:
 *   AirfobLog.write("info", "ble", "UNLOCK", "Door opened", mapOf("rssi" to rssi))
 *
 * ## What the public changelog already tells us to expect
 *
 *  - scanning runs behind a foreground service, so [boot] must create the
 *    notification channel and start it. A persistent notification is not
 *    avoidable on Android.
 *  - there is an RSSI reset API (added 2.3.15); tap range needs per-reader
 *    tuning and [resetRssi] is the first thing support will reach for.
 *  - the licence expires at runtime (added 2.3.25) — surface it through
 *    [status] so the diagnostics screen can say so.
 */
class RealAirfobSdk(
    private val context: Context,
    private val emit: SdkEmitter
) : AirfobSdk {

    private fun notImplemented(method: String): Nothing =
        throw AirfobError(
            "E_NOT_READY",
            "RealAirfobSdk.$method is not implemented — see docs/P5-INTEGRATION.md"
        )

    override fun boot(config: Map<String, Any?>) {
        // TODO(P5): initialise the MOCA SDK with config["siteId"] / config["apiKey"],
        //   start the foreground service, and register the callback that forwards
        //   reader detection and unlock results through emit().
        notImplemented("boot")
    }

    override fun status(): SdkStatus {
        // TODO(P5): read SDK readiness, registered card count, and licence state.
        notImplemented("status")
    }

    override fun register(token: String): List<Card> {
        // TODO(P5): hand `token` — issued by your backend against the Airfob API —
        //   to the SDK's card registration call, then map the result to Card.
        notImplemented("register")
    }

    override fun cards(): List<Card> {
        // TODO(P5): list credentials held on this device.
        notImplemented("cards")
    }

    override fun unlock(cardId: String?): String {
        // TODO(P5): trigger the SDK's open-door call. Return the outcome rather
        //   than throwing for noReader/denied — those are results, not errors.
        notImplemented("unlock")
    }

    override fun unregister(cardId: String?): List<Card> {
        // TODO(P5): delete the credential from this device. Test this properly —
        //   offboarding is the path that gets skipped and matters most.
        notImplemented("unregister")
    }

    override fun resetRssi() {
        // TODO(P5): call the SDK's RSSI reset.
        notImplemented("resetRssi")
    }

    override fun teardown() {
        // TODO(P5): stop scanning and release the SDK.
    }
}

/**
 * Discovered by name from [AirfobCore]. Must keep its no-argument constructor.
 */
class RealAirfobSdkFactory : AirfobSdkFactory {
    override fun create(context: Context, emit: SdkEmitter): AirfobSdk =
        RealAirfobSdk(context, emit)
}
