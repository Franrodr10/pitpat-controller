package io.github.franrodr10.pitpat.core.control

import io.github.franrodr10.pitpat.core.protocol.TreadmillStatus
import kotlin.math.roundToLong

/**
 * Some firmwares always report 0 steps. Until the treadmill reports a real count, steps are
 * estimated from the distance walked, using a cadence that grows with speed: about 94 steps/min
 * at 3 km/h and 125 at 6 km/h, a rough fit of typical walking cadences.
 */
class StepEstimator {

    data class Steps(val count: Long, val estimated: Boolean)

    private var treadmillCounts = false
    private var lastDistanceKm: Double? = null
    private var lastDurationS = 0L
    private var estimate = 0.0

    fun update(status: TreadmillStatus): Steps {
        if (status.steps > 0) treadmillCounts = true
        if (treadmillCounts) return Steps(status.steps, estimated = false)

        val previous = lastDistanceKm
        if (previous == null || status.distanceKm < previous || status.durationSeconds < lastDurationS) {
            // Connected mid-session or counters reset: start from the distance already walked.
            estimate = if (status.distanceKm > 0) status.distanceKm * 1000 / stepLengthM(averageSpeed(status)) else 0.0
        } else {
            val walkedM = (status.distanceKm - previous) * 1000
            val speed = if (status.speedKmh > 0) status.speedKmh else averageSpeed(status)
            if (walkedM > 0) estimate += walkedM / stepLengthM(speed)
        }
        lastDistanceKm = status.distanceKm
        lastDurationS = status.durationSeconds
        return Steps(estimate.roundToLong(), estimated = true)
    }

    fun reset() {
        treadmillCounts = false
        lastDistanceKm = null
        lastDurationS = 0
        estimate = 0.0
    }

    private fun averageSpeed(status: TreadmillStatus): Double =
        if (status.durationSeconds > 0) status.distanceKm / (status.durationSeconds / 3600.0) else 3.0

    companion object {
        /** Steps per minute when walking at [kmh]. */
        fun cadence(kmh: Double): Double = 62 + 10.5 * kmh.coerceIn(1.0, 8.0)

        fun stepLengthM(kmh: Double): Double = kmh.coerceIn(1.0, 8.0) * 1000 / 60 / cadence(kmh)
    }
}
