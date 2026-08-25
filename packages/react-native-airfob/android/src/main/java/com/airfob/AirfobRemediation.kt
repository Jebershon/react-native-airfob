package com.airfob

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Turns a failing diagnostic into a tap that fixes it.
 *
 * The difference between "Bluetooth is off" and a button that opens Bluetooth
 * settings is the difference between a support call and a user solving it in
 * four seconds. Sending people to Settings generically does not count — every
 * action here lands on the exact screen.
 *
 * Android can deep-link precisely. iOS cannot; see AirfobRemediation.swift for
 * what that costs.
 */
object AirfobRemediation {

    /** Action ids are shared with iOS and with the JS layer. */
    const val OPEN_BLUETOOTH = "openBluetoothSettings"
    const val OPEN_APP_SETTINGS = "openAppSettings"
    const val OPEN_LOCATION = "openLocationSettings"
    const val OPEN_NOTIFICATIONS = "openNotificationSettings"
    const val OPEN_BATTERY = "openBatterySettings"
    const val REQUEST_BATTERY_EXEMPTION = "requestBatteryExemption"

    /**
     * @return true when a settings screen was opened.
     * @throws AirfobError when the id is unknown or nothing on the device can
     *   handle it — callers surface that rather than leaving a dead button.
     */
    fun run(context: Context, actionId: String): Boolean {
        val intent = intentFor(context, actionId)
            ?: throw AirfobError("E_SDK", "Unknown remediation action \"$actionId\"")

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        val started = tryStart(context, intent)
        if (started) {
            AirfobLog.write("info", "perm", "REMEDIATE", "Opened settings for $actionId")
            return true
        }

        // OEM builds routinely drop individual settings screens. App details is
        // present on every device and gets the user to the right general area.
        val fallback = appDetailsIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (actionId != OPEN_APP_SETTINGS && tryStart(context, fallback)) {
            AirfobLog.write(
                "warn", "perm", "REMEDIATE_FALLBACK",
                "No handler for $actionId — opened app details instead"
            )
            return true
        }

        AirfobLog.write("error", "perm", "REMEDIATE_FAIL", "Nothing could handle $actionId")
        throw AirfobError("E_SDK", "No settings screen on this device can handle \"$actionId\"")
    }

    private fun intentFor(context: Context, actionId: String): Intent? = when (actionId) {
        OPEN_BLUETOOTH -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)

        OPEN_APP_SETTINGS -> appDetailsIntent(context)

        OPEN_LOCATION -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)

        OPEN_NOTIFICATIONS ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            } else {
                appDetailsIntent(context)
            }

        // The list, not the direct prompt. See below.
        OPEN_BATTERY -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)

        /**
         * The one-tap exemption prompt. Requires REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
         * in the manifest, which this package deliberately does NOT declare:
         * Google Play restricts that permission to apps whose core function needs
         * it, and shipping it without an approved declaration risks the listing.
         *
         * Access control plausibly qualifies. If your listing is approved, add the
         * permission to your app manifest and this action starts working; until
         * then OPEN_BATTERY is the safe route.
         */
        REQUEST_BATTERY_EXEMPTION ->
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + context.packageName))

        else -> null
    }

    private fun appDetailsIntent(context: Context) =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))

    private fun tryStart(context: Context, intent: Intent): Boolean =
        runCatching { context.startActivity(intent); true }.getOrDefault(false)
}
