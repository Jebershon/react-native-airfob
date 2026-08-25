package com.airfob

import android.content.Context

/**
 * The single seam between this package and MOCA System's Airfob SDK.
 *
 * Nothing outside this file imports a MOCA class. Swapping [MockAirfobSdk] for
 * [RealAirfobSdk] is a one-line change in [AirfobModule], which is what makes
 * P1 shippable without a licence.
 */

data class Card(
    val id: String,
    val name: String,
    val siteName: String,
    val status: String,
    val accessLevels: List<String> = emptyList()
)

data class SdkStatus(
    val sdkReady: Boolean,
    val registered: Boolean,
    val licence: String,
    val cardCount: Int
)

class AirfobError(val code: String, message: String) : Exception(message)

/** Emits an event up to JS. */
typealias SdkEmitter = (name: String, data: Map<String, Any?>) -> Unit

interface AirfobSdk {
    /** Called at process start. Must be cheap and must not throw when unenrolled. */
    fun boot(config: Map<String, Any?>)
    fun status(): SdkStatus
    fun register(token: String): List<Card>
    fun cards(): List<Card>
    /** @return "opened" | "noReader" | "denied" */
    fun unlock(cardId: String?): String
    fun unregister(cardId: String?): List<Card>

    /**
     * Clears cached per-reader RSSI values. The SDK learns a signal baseline for
     * each reader; when a reader is moved or replaced that baseline goes stale
     * and taps start failing at the old distance. MOCA added an API for this in
     * 2.3.15 — it is the first thing to try when one door goes bad.
     */
    fun resetRssi()

    fun teardown()
}

/* ------------------------------------------------------------------ mock --- */

/**
 * Behaves like the real thing minus the radio. Credentials persist across
 * restarts so the enrolment flow can be tested properly.
 */
class MockAirfobSdk(
    private val context: Context,
    private val emit: SdkEmitter
) : AirfobSdk {

    private val prefs by lazy {
        context.getSharedPreferences("airfob-mock", Context.MODE_PRIVATE)
    }

    private var ready = false
    private var stored = mutableListOf<Card>()

    override fun boot(config: Map<String, Any?>) {
        ready = true
        restore()
        AirfobLog.write(
            "info", "sdk", "BOOT",
            "Mock SDK booted with ${stored.size} credential(s)",
            mapOf("siteId" to config["siteId"])
        )
        emit("status", mapOf("status" to statusMap()))
    }

    override fun status() = SdkStatus(
        sdkReady = ready,
        registered = stored.isNotEmpty(),
        licence = "valid",
        cardCount = stored.size
    )

    override fun register(token: String): List<Card> {
        if (!ready) throw AirfobError("E_NOT_READY", "boot() has not been called")
        stored = mutableListOf(
            Card(
                id = "mock-${token.take(8)}",
                name = "Mock Credential",
                siteName = "Mock Site",
                status = "active",
                accessLevels = listOf("All doors")
            )
        )
        persist()
        AirfobLog.write("info", "sdk", "REGISTER", "Registered ${stored.size} credential(s)")
        emit("status", mapOf("status" to statusMap()))
        return stored
    }

    override fun cards(): List<Card> = stored

    override fun unlock(cardId: String?): String {
        if (!ready) throw AirfobError("E_NOT_READY", "boot() has not been called")
        if (stored.isEmpty()) throw AirfobError("E_NO_CARD", "No credential registered")

        val rssi = -62
        AirfobLog.write(
            "info", "ble", "UNLOCK", "Door opened",
            mapOf("cardId" to (cardId ?: stored.first().id), "rssi" to rssi)
        )
        emit("unlockResult", mapOf("result" to "opened", "readerId" to "mock-reader", "rssi" to rssi))
        return "opened"
    }

    override fun unregister(cardId: String?): List<Card> {
        stored.clear()
        persist()
        AirfobLog.write("info", "sdk", "UNREGISTER", "Credentials cleared")
        emit("status", mapOf("status" to statusMap()))
        return stored
    }

    override fun resetRssi() {
        AirfobLog.write("info", "ble", "RSSI_RESET", "Cached reader RSSI values cleared")
    }

    override fun teardown() {
        ready = false
    }

    private fun statusMap(): Map<String, Any?> = status().let {
        mapOf(
            "sdkReady" to it.sdkReady,
            "registered" to it.registered,
            "licence" to it.licence,
            "cardCount" to it.cardCount
        )
    }

    private fun persist() {
        prefs.edit().putString("cardId", stored.firstOrNull()?.id).apply()
    }

    private fun restore() {
        val id = prefs.getString("cardId", null) ?: return
        stored = mutableListOf(Card(id, "Mock Credential", "Mock Site", "active", listOf("All doors")))
    }
}

/* --------------------------------------------------------------- factory --- */

/**
 * Lets [AirfobCore] obtain a real adapter without the main source set naming a
 * class that may not be compiled. RealAirfobSdkFactory lives in src/withSdk and
 * exists only when the licensed AAR is in libs/; [AirfobCore] looks it up by
 * name and falls back to the mock.
 *
 * Implementations must have a no-argument constructor.
 */
interface AirfobSdkFactory {
    fun create(context: Context, emit: SdkEmitter): AirfobSdk
}
