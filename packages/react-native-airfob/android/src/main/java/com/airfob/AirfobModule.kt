package com.airfob

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import org.json.JSONObject

/**
 * React Native module "Airfob".
 *
 * Translates between RN's ReadableMap/WritableMap and plain Kotlin, and nothing
 * else. It holds no state and makes no SDK calls of its own — the SDK lives in
 * [AirfobCore] so it outlives the JS layer.
 */
class AirfobModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), PermissionListener {

    companion object {
        const val NAME = "Airfob"
        private const val EVENT = "airfob"
        private const val PERMISSION_REQUEST = 0xA1F0
    }

    private var permissionPromise: Promise? = null
    private var listenerCount = 0

    private val sdk: AirfobSdk get() = AirfobCore.sdk(reactContext)

    override fun getName() = NAME

    override fun initialize() {
        super.initialize()
        AirfobLog.attach(reactContext)
        AirfobCore.setEmitter(::emit)
    }

    override fun invalidate() {
        AirfobCore.setEmitter(null)
        super.invalidate()
    }

    /* ------------------------------------------------------------ commands -- */

    @ReactMethod
    fun boot(options: ReadableMap, promise: Promise) = guard(promise) {
        options.getStringOrNull("logLevel")?.let { AirfobLog.setLevel(it) }
        AirfobCore.boot(reactContext, options.toHashMap())
        Arguments.createMap().apply {
            putBoolean("sdkReady", sdk.status().sdkReady)
            putBoolean("mock", AirfobCore.isMock)
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) = guard(promise) { statusMap() }

    @ReactMethod
    fun register(options: ReadableMap, promise: Promise) = guard(promise) {
        val token = options.getStringOrNull("token")
            ?: throw AirfobError("E_SDK", "register requires a token")
        cardsMap(sdk.register(token))
    }

    @ReactMethod
    fun getCards(promise: Promise) = guard(promise) { cardsMap(sdk.cards()) }

    @ReactMethod
    fun unregister(options: ReadableMap, promise: Promise) = guard(promise) {
        cardsMap(sdk.unregister(options.getStringOrNull("cardId")))
    }

    /**
     * Manual unlock. Tap-and-go never reaches here — the SDK opens the door on
     * proximity with no JS involved. Bluetooth and permissions are re-checked
     * because the user can revoke either between page load and button press.
     */
    @ReactMethod
    fun unlock(options: ReadableMap, promise: Promise) = guard(promise) {
        val bt = AirfobDiagnostics.bluetoothState(reactContext)
        if (bt != "on") throw AirfobError("E_BT_OFF", "Bluetooth is $bt")
        if (AirfobDiagnostics.missingPermissions(reactContext).isNotEmpty()) {
            throw AirfobError("E_PERMISSION", "Bluetooth permission not granted")
        }
        val result = sdk.unlock(options.getStringOrNull("cardId"))
        Arguments.createMap().apply { putString("result", result) }
    }

    @ReactMethod
    fun getDiagnostics(promise: Promise) = guard(promise) {
        val checks = AirfobDiagnostics.run(reactContext, sdk, AirfobCore.isMock)
        val array = Arguments.createArray()
        checks.forEach { check ->
            array.pushMap(Arguments.createMap().apply {
                putString("id", check.id)
                putString("label", check.label)
                putString("state", check.state)
                putString("detail", check.detail)
                check.action?.let { putString("action", it) } ?: putNull("action")
                check.actionLabel?.let { putString("actionLabel", it) } ?: putNull("actionLabel")
                check.remedy?.let { putString("remedy", it) } ?: putNull("remedy")
            })
        }
        Arguments.createMap().apply {
            putArray("checks", array)
            putString("summary", if (checks.any { it.state == "fail" }) "fail" else "pass")
            putMap("device", Arguments.createMap().apply {
                AirfobDiagnostics.device().forEach { (k, v) -> putString(k, v) }
            })
        }
    }

    /**
     * Opens the exact OS settings screen that fixes a failing check. The gap
     * between naming a problem and fixing it in one tap is most of the support
     * load, so this is not a nice-to-have.
     */
    @ReactMethod
    fun remediate(actionId: String, promise: Promise) = guard(promise) {
        val opened = AirfobRemediation.run(reactContext, actionId)
        Arguments.createMap().apply { putBoolean("opened", opened) }
    }

    /** Verbose internal state for a support bundle or the dev panel. */
    @ReactMethod
    fun getRawState(promise: Promise) = guard(promise) {
        Arguments.createMap().apply {
            AirfobDiagnostics.rawState(reactContext, sdk, AirfobCore.isMock)
                .forEach { (key, value) -> putAny(key, value) }
        }
    }

    /** First thing to try when one specific door starts refusing taps. */
    @ReactMethod
    fun resetRssi(promise: Promise) = guard(promise) {
        sdk.resetRssi()
        Arguments.createMap().apply { putBoolean("reset", true) }
    }

    /* --------------------------------------------------------- permissions -- */

    @ReactMethod
    fun requestPermissions(promise: Promise) {
        val missing = AirfobDiagnostics.missingPermissions(reactContext)
        if (missing.isEmpty()) {
            promise.resolve(permissionResult(emptyList()))
            return
        }

        val activity = currentActivity as? PermissionAwareActivity
        if (activity == null) {
            AirfobLog.write("error", "perm", "NO_ACTIVITY", "Cannot request permissions with no activity")
            promise.reject("E_PERMISSION", "No activity available to request permissions")
            return
        }

        permissionPromise = promise
        AirfobLog.write("info", "perm", "REQUEST", "Requesting " + missing.joinToString())
        activity.requestPermissions(missing.toTypedArray(), PERMISSION_REQUEST, this)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ): Boolean {
        if (requestCode != PERMISSION_REQUEST) return false
        val promise = permissionPromise ?: return true
        permissionPromise = null

        val stillMissing = AirfobDiagnostics.missingPermissions(reactContext)
        AirfobLog.write(
            if (stillMissing.isEmpty()) "info" else "warn",
            "perm", "RESULT",
            if (stillMissing.isEmpty()) "All granted" else "Still missing " + stillMissing.joinToString()
        )
        promise.resolve(permissionResult(stillMissing))
        return true
    }

    private fun permissionResult(missing: List<String>): WritableMap =
        Arguments.createMap().apply {
            putBoolean("granted", missing.isEmpty())
            putArray("missing", Arguments.createArray().apply { missing.forEach { pushString(it) } })
        }

    /* ---------------------------------------------------------------- log --- */

    @ReactMethod
    fun logWrite(entry: ReadableMap, promise: Promise) = guard(promise) {
        AirfobLog.writeRaw(JSONObject(entry.toHashMap() as Map<*, *>))
        Arguments.createMap()
    }

    @ReactMethod
    fun logSetLevel(level: String, promise: Promise) = guard(promise) {
        AirfobLog.setLevel(level)
        Arguments.createMap().apply { putString("level", AirfobLog.getLevel()) }
    }

    @ReactMethod
    fun logGet(options: ReadableMap, promise: Promise) = guard(promise) {
        val entries = AirfobLog.entries(options.getStringOrNull("since"))
        val array = Arguments.createArray()
        entries.forEach { array.pushMap(jsonToMap(it)) }
        Arguments.createMap().apply { putArray("entries", array) }
    }

    @ReactMethod
    fun logClear(promise: Promise) = guard(promise) {
        AirfobLog.clear()
        Arguments.createMap()
    }

    @ReactMethod
    fun logExport(json: String, promise: Promise) = guard(promise) {
        val path = AirfobLog.exportBundle(reactContext, json)
        AirfobLog.write("info", "bridge", "EXPORT", "Support bundle written")
        Arguments.createMap().apply { putString("path", path) }
    }

    /* -------------------------------------------------- NativeEventEmitter -- */

    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount += 1
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount = maxOf(0, listenerCount - count)
    }

    private fun emit(name: String, data: Map<String, Any?>) {
        if (listenerCount == 0) return
        val map = Arguments.createMap().apply {
            putString("name", name)
            data.forEach { (key, value) -> putAny(key, value) }
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT, map)
    }

    /* -------------------------------------------------------------- utils --- */

    private inline fun guard(promise: Promise, block: () -> WritableMap) {
        try {
            promise.resolve(block())
        } catch (e: AirfobError) {
            promise.reject(e.code, e.message, e)
        } catch (e: Exception) {
            AirfobLog.write("error", "bridge", "E_SDK", e.message ?: e.toString())
            promise.reject("E_SDK", e.message ?: e.toString(), e)
        }
    }

    private fun statusMap(): WritableMap {
        val s = sdk.status()
        val missing = AirfobDiagnostics.missingPermissions(reactContext)
        return Arguments.createMap().apply {
            putBoolean("sdkReady", s.sdkReady)
            putBoolean("mock", AirfobCore.isMock)
            putBoolean("registered", s.registered)
            putString("bluetooth", AirfobDiagnostics.bluetoothState(reactContext))
            putString("permissions", if (missing.isEmpty()) "granted" else "denied")
            putString("licence", s.licence)
            putInt("cardCount", s.cardCount)
        }
    }

    private fun cardsMap(cards: List<Card>): WritableMap {
        val array = Arguments.createArray()
        cards.forEach { card ->
            array.pushMap(Arguments.createMap().apply {
                putString("id", card.id)
                putString("name", card.name)
                putString("siteName", card.siteName)
                putString("status", card.status)
                putArray("accessLevels", Arguments.createArray().apply {
                    card.accessLevels.forEach { pushString(it) }
                })
            })
        }
        return Arguments.createMap().apply { putArray("cards", array) }
    }

    private fun jsonToMap(json: JSONObject): WritableMap =
        Arguments.createMap().apply {
            json.keys().forEach { key ->
                when (val value = json.get(key)) {
                    is JSONObject -> putMap(key, jsonToMap(value))
                    else -> putAny(key, value)
                }
            }
        }

    private fun WritableMap.putAny(key: String, value: Any?) {
        when (value) {
            null -> putNull(key)
            is Boolean -> putBoolean(key, value)
            is Int -> putInt(key, value)
            is Double -> putDouble(key, value)
            is Float -> putDouble(key, value.toDouble())
            else -> putString(key, value.toString())
        }
    }

    private fun ReadableMap.getStringOrNull(key: String): String? =
        if (hasKey(key) && !isNull(key)) getString(key) else null
}
