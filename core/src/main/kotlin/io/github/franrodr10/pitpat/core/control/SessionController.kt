package io.github.franrodr10.pitpat.core.control

import io.github.franrodr10.pitpat.core.protocol.RunState
import io.github.franrodr10.pitpat.core.protocol.TreadmillProtocol
import io.github.franrodr10.pitpat.core.protocol.TreadmillStatus
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Turns user actions and treadmill status into commands, enforcing the safety rules:
 *
 * - speeds are rounded to 0.1 km/h and clamped to the protocol range and the treadmill's maximum;
 * - speed changes are only sent while the belt runs and the status is fresh;
 * - STOP is always sent when connected, and re-sent if the belt keeps moving;
 * - nothing is sent on its own after a reconnection: the link going down clears pending work.
 */
class SessionController(private val protocol: TreadmillProtocol, initialTargetKmh: Double) {

    enum class Notice { NOT_CONNECTED, NO_DATA, STOP_NOT_CONFIRMED }

    data class Outcome(val commands: List<Command> = emptyList(), val notice: Notice? = null)

    var status: TreadmillStatus? = null
        private set

    private var statusAtMs = 0L
    private var pendingStartKmh: Double? = null
    private var pendingStartAtMs = 0L
    private var localChangeAtMs: Long? = null
    private var stopSentAtMs: Long? = null
    private var stopResends = 0

    /** Speed for the next start, or the current target while running. */
    var targetKmh: Double = clamp(initialTargetKmh)
        private set

    /** The protocol range, capped by the maximum the treadmill reports. */
    val speedRange: ClosedFloatingPointRange<Double>
        get() {
            val range = protocol.speedRange
            val reportedMax = status?.maxSpeedKmh ?: return range
            return if (reportedMax >= range.start && reportedMax < range.endInclusive) range.start..reportedMax else range
        }

    fun hasFreshStatus(nowMs: Long): Boolean = status != null && nowMs - statusAtMs <= FRESH_MS

    fun onStatus(newStatus: TreadmillStatus, nowMs: Long): Outcome {
        status = newStatus
        statusAtMs = nowMs
        val commands = mutableListOf<Command>()
        var notice: Notice? = null

        // A speed chosen at start or during the countdown is applied once the belt runs.
        pendingStartKmh?.let { wanted ->
            if (nowMs - pendingStartAtMs > PENDING_START_TIMEOUT_MS) {
                pendingStartKmh = null
            } else if (newStatus.state == RunState.RUNNING) {
                pendingStartKmh = null
                val speed = clamp(wanted)
                if (abs(newStatus.targetSpeedKmh - speed) > SPEED_TOLERANCE_KMH) commands += speedCommand(speed)
                localChangeAtMs = nowMs
            }
        }

        // Follow changes made with the remote, unless the user has just changed the speed here.
        val localChange = localChangeAtMs
        if (newStatus.state == RunState.RUNNING && pendingStartKmh == null && newStatus.targetSpeedKmh > 0 &&
            (localChange == null || nowMs - localChange > LOCAL_CHANGE_HOLD_MS)
        ) {
            targetKmh = clamp(newStatus.targetSpeedKmh)
        }

        // Make sure STOP took effect.
        stopSentAtMs?.let { sentAt ->
            if (!newStatus.isMoving) {
                stopSentAtMs = null
            } else if (nowMs - sentAt >= STOP_CHECK_MS) {
                if (stopResends < MAX_STOP_RESENDS) {
                    stopResends++
                    stopSentAtMs = nowMs
                    commands += stopCommand()
                } else {
                    stopSentAtMs = null
                    notice = Notice.STOP_NOT_CONFIRMED
                }
            }
        }
        return Outcome(commands, notice)
    }

    /** The link dropped: forget the status and anything pending, so nothing is resent later. */
    fun onLinkDown() {
        status = null
        pendingStartKmh = null
        stopSentAtMs = null
        stopResends = 0
    }

    fun startOrPause(connected: Boolean, nowMs: Long): Outcome {
        if (!connected) return Outcome(notice = Notice.NOT_CONNECTED)
        val current = status
        if (current == null || !hasFreshStatus(nowMs)) return Outcome(notice = Notice.NO_DATA)
        return when (current.state) {
            RunState.RUNNING -> {
                pendingStartKmh = null
                Outcome(listOf(Command(CommandKind.CONTROL, protocol.pauseFrame(), "pausa")))
            }
            RunState.STARTING -> Outcome()
            RunState.STOPPED, RunState.PAUSED -> {
                val speed = clamp(targetKmh)
                targetKmh = speed
                pendingStartKmh = speed
                pendingStartAtMs = nowMs
                stopSentAtMs = null
                Outcome(listOf(Command(CommandKind.CONTROL, protocol.startFrame(speed), "arrancar ${format(speed)} km/h")))
            }
        }
    }

    fun stop(connected: Boolean, nowMs: Long): Outcome {
        if (!connected) return Outcome(notice = Notice.NOT_CONNECTED)
        pendingStartKmh = null
        stopSentAtMs = nowMs
        stopResends = 0
        return Outcome(listOf(stopCommand()))
    }

    fun changeSpeed(deltaKmh: Double, connected: Boolean, nowMs: Long): Outcome =
        selectSpeed(targetKmh + deltaKmh, connected, nowMs)

    fun selectSpeed(kmh: Double, connected: Boolean, nowMs: Long): Outcome {
        val speed = clamp(kmh)
        targetKmh = speed
        localChangeAtMs = nowMs
        val current = status
        if (!connected || current == null || !hasFreshStatus(nowMs)) return Outcome()
        return when (current.state) {
            RunState.RUNNING -> Outcome(listOf(speedCommand(speed)))
            RunState.STARTING -> {
                pendingStartKmh = speed
                pendingStartAtMs = nowMs
                Outcome()
            }
            RunState.STOPPED, RunState.PAUSED -> Outcome()
        }
    }

    private fun speedCommand(speed: Double) =
        Command(CommandKind.SPEED, protocol.speedFrame(speed), "velocidad ${format(speed)} km/h")

    private fun stopCommand() = Command(CommandKind.STOP, protocol.stopFrame(), "PARAR")

    /** Rounds to 0.1 km/h first, then clamps, so the result can never exceed the range. */
    private fun clamp(kmh: Double): Double {
        val rounded = (kmh * 10).roundToInt() / 10.0
        return rounded.coerceIn(speedRange)
    }

    private fun format(kmh: Double) = "%.1f".format(Locale.ROOT, kmh)

    companion object {
        const val FRESH_MS = 3_000L
        const val LOCAL_CHANGE_HOLD_MS = 2_000L
        const val PENDING_START_TIMEOUT_MS = 15_000L
        const val STOP_CHECK_MS = 3_000L
        const val MAX_STOP_RESENDS = 2
        private const val SPEED_TOLERANCE_KMH = 0.05
    }
}
