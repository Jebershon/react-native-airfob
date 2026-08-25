package com.airfob

import android.content.Context
import androidx.startup.Initializer

/**
 * Runs at process start via androidx.startup, before any React Native code.
 *
 * Registered from this package's own manifest, so a host app — including a
 * Mendix Native Template — gets it by adding the dependency and nothing else.
 * No MainApplication edit, no native template patch.
 */
class AirfobInitializer : Initializer<Unit> {

    override fun create(context: Context) {
        AirfobLog.attach(context)
        AirfobLog.write("info", "service", "PROCESS_START", "Airfob initializer ran")
        AirfobCore.bootIfEnrolled(context)
    }

    override fun dependencies(): List<Class<out Initializer<*>>> = emptyList()
}
