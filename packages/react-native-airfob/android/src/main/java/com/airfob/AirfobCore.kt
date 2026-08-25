package com.airfob

import android.content.Context

/**
 * Process-wide owner of the SDK instance.
 *
 * Exists because of one hard requirement: tap-and-go must work while the app is
 * closed. If the SDK were created by the React Native module it would only exist
 * while the JS layer is alive, which is almost never at the moment a user holds
 * their phone against a reader.
 *
 * So the SDK is started by [AirfobInitializer] at process start, and the RN
 * module attaches to whatever is already running.
 */
object AirfobCore {

    @Volatile private var sdkInstance: AirfobSdk? = null
    @Volatile private var emitter: SdkEmitter? = null
    @Volatile private var booted = false

    /** Swap to RealAirfobSdk in P5. This is the only line that has to change. */
    private fun create(context: Context): AirfobSdk =
        MockAirfobSdk(context.applicationContext, ::dispatch)

    /** True while the mock is in use — surfaced in diagnostics so it is never a surprise. */
    val isMock: Boolean
        get() = sdkInstance is MockAirfobSdk

    fun sdk(context: Context): AirfobSdk = synchronized(this) {
        sdkInstance ?: create(context).also { sdkInstance = it }
    }

    /**
     * Called at process start. Guarded so an unenrolled device does nothing
     * expensive: no scanning, no foreground service, no notification.
     */
    fun bootIfEnrolled(context: Context) {
        val instance = sdk(context)
        val enrolled = runCatching { instance.cards().isNotEmpty() }.getOrDefault(false)

        if (!enrolled) {
            AirfobLog.write(
                "info", "service", "BOOT_SKIP",
                "No credential on this device — not starting the scanner"
            )
            return
        }

        boot(context, emptyMap())
    }

    fun boot(context: Context, config: Map<String, Any?>): Unit = synchronized(this) {
        if (booted) return@synchronized
        runCatching { sdk(context).boot(config) }
            .onSuccess {
                booted = true
                AirfobLog.write("info", "service", "BOOT", "Scanner started")
            }
            .onFailure {
                AirfobLog.write(
                    "error", "service", "BOOT_FAIL",
                    it.message ?: "Boot failed"
                )
            }
    }

    /** The RN module registers itself here; before that, events go to the log only. */
    fun setEmitter(next: SdkEmitter?) {
        emitter = next
    }

    private fun dispatch(name: String, data: Map<String, Any?>) {
        emitter?.invoke(name, data)
            ?: AirfobLog.write("debug", "sdk", "EVENT_DROPPED", "No JS listener for \"$name\"")
    }
}
