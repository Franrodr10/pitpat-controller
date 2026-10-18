package io.github.franrodr10.pitpat.session

import android.content.Context
import androidx.core.content.edit

/** Small persistent settings: the remembered treadmill, speed presets and options. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    val deviceAddress: String? get() = prefs.getString(KEY_ADDRESS, null)
    val deviceName: String? get() = prefs.getString(KEY_NAME, null)
    val protocolName: String? get() = prefs.getString(KEY_PROTOCOL, null)

    fun saveDevice(address: String, name: String?, protocol: String) = prefs.edit {
        putString(KEY_ADDRESS, address)
        putString(KEY_NAME, name)
        putString(KEY_PROTOCOL, protocol)
    }

    fun forgetDevice() = prefs.edit {
        remove(KEY_ADDRESS)
        remove(KEY_NAME)
        remove(KEY_PROTOCOL)
    }

    var presets: List<Double>
        get() = prefs.getString(KEY_PRESETS, null)
            ?.split(';')
            ?.mapNotNull { it.toDoubleOrNull() }
            ?.takeIf { it.size == DEFAULT_PRESETS.size }
            ?: DEFAULT_PRESETS
        set(value) = prefs.edit { putString(KEY_PRESETS, value.joinToString(";")) }

    var targetKmh: Double
        get() = prefs.getString(KEY_TARGET, null)?.toDoubleOrNull() ?: DEFAULT_TARGET_KMH
        set(value) {
            if (value != targetKmh) prefs.edit { putString(KEY_TARGET, value.toString()) }
        }

    var keepAliveEnabled: Boolean
        get() = prefs.getBoolean(KEY_KEEP_ALIVE, true)
        set(value) = prefs.edit { putBoolean(KEY_KEEP_ALIVE, value) }

    companion object {
        val DEFAULT_PRESETS = listOf(3.0, 4.0, 5.0, 6.0)
        const val DEFAULT_TARGET_KMH = 2.0
        private const val KEY_ADDRESS = "device_address"
        private const val KEY_NAME = "device_name"
        private const val KEY_PROTOCOL = "device_protocol"
        private const val KEY_PRESETS = "presets"
        private const val KEY_TARGET = "target_kmh"
        private const val KEY_KEEP_ALIVE = "keep_alive"
    }
}
