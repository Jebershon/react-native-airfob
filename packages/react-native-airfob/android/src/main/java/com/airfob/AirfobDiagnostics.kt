package com.airfob

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat

/**
 * Every precondition that has to hold before a tap can open a door, evaluated
 * against the platform rather than the SDK. Deliberately SDK-free so it works in
 * P1 and tells you the truth even when the SDK itself is broken.
 *
 * In the field this resolves most "it just stopped working" reports without a
 * human ever looking at a log — provided each failure carries a way to fix it,
 * which is what [Check.action] is for.
 */
object AirfobDiagnostics {

    data class Check(
        val id: String,
        val label: String,
        val state: String,          // pass | fail | warn | unknown
        val detail: String,
        /** Remediation id from [AirfobRemediation], or null when the user cannot fix it. */
        val action: String? = null,
        /** Button text for [action]. */
        val actionLabel: String? = null,
        /** What to do when there is no action — shown as guidance. */
        val remedy: String? = null
    )

    fun requiredPermissions(): List<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    fun missingPermissions(context: Context): List<String> = requiredPermissions().filter {
        ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
    }

    fun bluetoothState(context: Context): String {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter ?: return "unsupported"
        return if (adapter.isEnabled) "on" else "off"
    }

    fun run(context: Context, sdk: AirfobSdk, mock: Boolean): List<Check> {
        val checks = mutableListOf<Check>()

        val bt = bluetoothState(context)
        checks += Check(
            id = "bluetooth",
            label = "Bluetooth enabled",
            state = if (bt == "on") "pass" else "fail",
            detail = bt,
            action = if (bt == "off") AirfobRemediation.OPEN_BLUETOOTH else null,
            actionLabel = if (bt == "off") "Turn on Bluetooth" else null,
            remedy = if (bt == "unsupported") "This device has no Bluetooth LE radio." else null
        )

        val missing = missingPermissions(context)
        checks += Check(
            id = "permissions",
            label = "Bluetooth permissions granted",
            state = if (missing.isEmpty()) "pass" else "fail",
            detail = if (missing.isEmpty()) "granted" else "missing: " + missing.joinToString { it.substringAfterLast('.') },
            action = if (missing.isEmpty()) null else AirfobRemediation.OPEN_APP_SETTINGS,
            actionLabel = if (missing.isEmpty()) null else "Open app permissions"
        )

        // Android 13+ silently drops the foreground-service notification without
        // this, and users read a missing notification as "the app is not running".
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            checks += Check(
                id = "notifications",
                label = "Notification permission",
                state = if (granted) "pass" else "warn",
                detail = if (granted) "granted" else "denied — the scanning notification will be hidden",
                action = if (granted) null else AirfobRemediation.OPEN_NOTIFICATIONS,
                actionLabel = if (granted) null else "Allow notifications"
            )
        }

        // Below API 31, BLE scanning returns zero results with location off — with
        // no error. This check exists because that failure is otherwise invisible.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            val on = lm?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ||
                lm?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
            checks += Check(
                id = "location",
                label = "Location services on",
                state = if (on) "pass" else "fail",
                detail = if (on) "enabled" else "BLE scanning returns nothing while this is off",
                action = if (on) null else AirfobRemediation.OPEN_LOCATION,
                actionLabel = if (on) null else "Turn on location"
            )
        }

        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val exempt = power?.isIgnoringBatteryOptimizations(context.packageName) == true
        checks += Check(
            id = "battery",
            label = "Exempt from battery optimisation",
            state = if (exempt) "pass" else "warn",
            detail = if (exempt) "exempt" else "the OS may kill scanning in the background",
            action = if (exempt) null else AirfobRemediation.OPEN_BATTERY,
            actionLabel = if (exempt) null else "Open battery settings",
            remedy = if (exempt) null else
                "Find this app in the list and set it to Not optimised."
        )

        val status = runCatching { sdk.status() }.getOrNull()
        checks += Check(
            id = "credential",
            label = "Credential present",
            state = if (status?.registered == true) "pass" else "fail",
            detail = "${status?.cardCount ?: 0} card(s)",
            remedy = if (status?.registered == true) null else
                "Activate your access from the home screen."
        )

        val cards = runCatching { sdk.cards() }.getOrDefault(emptyList())
        val allActive = cards.isNotEmpty() && cards.all { it.status == "active" }
        checks += Check(
            id = "credentialStatus",
            label = "Credential active",
            state = if (allActive) "pass" else "fail",
            detail = cards.joinToString { it.status }.ifEmpty { "none" },
            remedy = if (allActive) null else
                "Your access has been suspended or has expired. Contact your administrator."
        )

        checks += Check(
            id = "licence",
            label = "SDK licence valid",
            state = when (status?.licence) {
                "valid" -> "pass"
                null -> "unknown"
                else -> "fail"
            },
            detail = status?.licence ?: "unknown",
            // Nothing the user can do — this one is on the operator.
            remedy = if (status?.licence == "valid") null else
                "The Airfob licence for this app has expired. This needs an administrator."
        )

        checks += Check(
            id = "native",
            label = "Native SDK linked",
            state = if (mock) "warn" else "pass",
            detail = if (mock) "Running MockAirfobSdk — no Airfob SDK in this build" else "linked",
            remedy = if (mock) "Expected in Make It Native and in builds made before P5." else null
        )

        return checks
    }

    fun device(): Map<String, String> = mapOf(
        "platform" to "android",
        "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "osVersion" to "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    )

    /** Raw state for a support bundle. Deliberately verbose. */
    fun rawState(context: Context, sdk: AirfobSdk, mock: Boolean): Map<String, Any?> {
        val status = runCatching { sdk.status() }.getOrNull()
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return mapOf(
            "platform" to "android",
            "package" to context.packageName,
            "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
            "osVersion" to Build.VERSION.RELEASE,
            "apiLevel" to Build.VERSION.SDK_INT,
            "mock" to mock,
            "sdkReady" to (status?.sdkReady ?: false),
            "registered" to (status?.registered ?: false),
            "cardCount" to (status?.cardCount ?: 0),
            "licence" to (status?.licence ?: "unknown"),
            "bluetooth" to bluetoothState(context),
            "requiredPermissions" to requiredPermissions().joinToString(),
            "missingPermissions" to missingPermissions(context).joinToString().ifEmpty { "none" },
            "batteryExempt" to (power?.isIgnoringBatteryOptimizations(context.packageName) ?: false),
            "logLevel" to AirfobLog.getLevel(),
            "retentionDays" to AirfobLog.getRetention()
        )
    }
}
