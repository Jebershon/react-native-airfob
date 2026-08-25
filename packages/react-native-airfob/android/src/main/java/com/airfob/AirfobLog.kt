package com.airfob

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Bounded, disk-backed structured log.
 *
 * Two properties matter and drive the whole design:
 *
 *  1. It survives process death. The interesting failure — a tap that did not
 *     open a door — happens hours before the user opens the app to complain.
 *  2. It is bounded. Access logs on a device used every day would otherwise grow
 *     without limit, and they are personal data.
 *
 * Format is JSONL, one entry per line, rotated at [MAX_FILE_BYTES].
 * Logcat tag is a single constant so `adb logcat -s AIRFOB` just works.
 */
object AirfobLog {

    const val TAG = "AIRFOB"

    private const val RING_CAPACITY = 500
    private const val MAX_FILE_BYTES = 1_000_000L
    private const val FILE_NAME = "airfob-log.jsonl"
    private const val ROTATED_NAME = "airfob-log.1.jsonl"

    private val LEVELS = mapOf("off" to 0, "error" to 1, "warn" to 2, "info" to 3, "debug" to 4)

    private val ring = ArrayDeque<JSONObject>(RING_CAPACITY)
    private val lock = Any()

    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    @Volatile private var level: String = "info"
    @Volatile private var logFile: File? = null

    /** Called once from [AirfobInitializer] at process start. */
    fun attach(context: Context) {
        synchronized(lock) {
            if (logFile == null) {
                logFile = File(context.filesDir, FILE_NAME)
            }
        }
        // Replay whatever survived the last run so the ring is not empty on boot.
        loadTail()
    }

    fun setLevel(next: String) {
        if (LEVELS.containsKey(next)) level = next
    }

    fun getLevel(): String = level

    fun write(
        entryLevel: String,
        source: String,
        code: String,
        message: String,
        data: Map<String, Any?>? = null
    ) {
        val threshold = LEVELS[level] ?: 3
        val incoming = LEVELS[entryLevel] ?: 3
        if (threshold == 0 || incoming > threshold) return

        val entry = JSONObject().apply {
            put("ts", iso.format(Date()))
            put("lvl", entryLevel)
            put("src", source)
            put("code", code)
            put("msg", message)
            if (data != null && data.isNotEmpty()) put("data", JSONObject(data))
        }

        synchronized(lock) {
            if (ring.size >= RING_CAPACITY) ring.pollFirst()
            ring.addLast(entry)
        }

        appendToFile(entry)

        when (entryLevel) {
            "error" -> Log.e(TAG, "[$source/$code] $message")
            "warn" -> Log.w(TAG, "[$source/$code] $message")
            "debug" -> Log.d(TAG, "[$source/$code] $message")
            else -> Log.i(TAG, "[$source/$code] $message")
        }
    }

    /** Accepts an entry already shaped by the JS side, so both interleave. */
    fun writeRaw(entry: JSONObject) {
        synchronized(lock) {
            if (ring.size >= RING_CAPACITY) ring.pollFirst()
            ring.addLast(entry)
        }
        appendToFile(entry)
    }

    /** Newest last. [since] is an ISO timestamp. */
    fun entries(since: String? = null): List<JSONObject> = synchronized(lock) {
        val all = ring.toList()
        if (since == null) all else all.filter { it.optString("ts") >= since }
    }

    fun clear() {
        synchronized(lock) { ring.clear() }
        logFile?.let { file ->
            runCatching {
                file.delete()
                File(file.parentFile, ROTATED_NAME).delete()
            }
        }
    }

    /** Writes a support bundle next to the log and returns its absolute path. */
    fun exportBundle(context: Context, json: String): String {
        val out = File(context.cacheDir, "airfob-support-${System.currentTimeMillis()}.json")
        out.writeText(json)
        return out.absolutePath
    }

    /* ---------------------------------------------------------------- io --- */

    private fun appendToFile(entry: JSONObject) {
        val file = logFile ?: return
        runCatching {
            if (file.exists() && file.length() > MAX_FILE_BYTES) {
                val rotated = File(file.parentFile, ROTATED_NAME)
                rotated.delete()
                file.renameTo(rotated)
            }
            file.appendText(entry.toString() + "\n")
        }.onFailure {
            Log.w(TAG, "Could not append to log file: ${it.message}")
        }
    }

    private fun loadTail() {
        val file = logFile ?: return
        if (!file.exists()) return
        runCatching {
            val lines = file.readLines().takeLast(RING_CAPACITY)
            synchronized(lock) {
                ring.clear()
                lines.forEach { line ->
                    runCatching { ring.addLast(JSONObject(line)) }
                }
            }
        }.onFailure {
            Log.w(TAG, "Could not replay log file: ${it.message}")
        }
    }
}
