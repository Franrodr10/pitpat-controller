package io.github.franrodr10.pitpat.ui

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

/** Numbers as written in Spanish: "3,5 km/h", "1.234 pasos". */
object Format {
    private val spanish: Locale = Locale.forLanguageTag("es-ES")

    fun speed(kmh: Double): String = String.format(spanish, "%.1f", kmh)

    /** Presets without a useless ",0": "3", "3,5". */
    fun preset(kmh: Double): String = if (kmh % 1.0 == 0.0) kmh.toInt().toString() else speed(kmh)

    fun distance(km: Double): String = String.format(spanish, "%.2f", km)

    fun count(value: Long): String = NumberFormat.getIntegerInstance(spanish).format(value)

    fun duration(totalSeconds: Long): String {
        val hours = totalSeconds / 3600
        val minutes = totalSeconds % 3600 / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%02d:%02d".format(minutes, seconds)
    }

    /** Accepts "3,5" or "3.5"; rounds to one decimal. */
    fun parseSpeed(text: String): Double? =
        text.trim().replace(',', '.').toDoubleOrNull()?.let { (it * 10).roundToInt() / 10.0 }
}
