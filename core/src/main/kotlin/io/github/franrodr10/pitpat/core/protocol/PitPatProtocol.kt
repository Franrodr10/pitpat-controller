package io.github.franrodr10.pitpat.core.protocol

import kotlin.math.roundToInt

/**
 * PitPat treadmills with service 0xFBA0 (BLE name "PitPat-T01").
 * Frame layout and field offsets are documented in docs/PROTOCOL.md.
 */
object PitPatProtocol : TreadmillProtocol {
    override val name = "PitPat"
    override val service = uuid16(0xFBA0)
    override val commandCharacteristic = uuid16(0xFBA1)
    override val statusCharacteristics = listOf(uuid16(0xFBA2))
    override val advertisedServices = listOf(uuid16(0xFBA0), uuid16(0x1910))
    override val namePrefixes = listOf("PitPat")
    override val speedRange = 1.0..6.0
    override val keepAliveFrame: ByteArray
        get() = byteArrayOf(0x6A, 0x05, 0xFD.toByte(), 0xF8.toByte(), END.toByte())
    override val keepAliveIntervalMs = 1_000L

    private const val COMMAND_START = 0x6A
    private const val END = 0x43
    private const val OP_STOP = 0x00
    private const val OP_PAUSE = 0x02
    private const val OP_START = 0x04
    private const val MODE_START = 1
    private const val MODE_SPEED = 5
    private const val WEIGHT_KG = 80
    private const val USER_ID = 58_965_456_623L
    private const val MIN_STATUS_LENGTH = 31

    override fun startFrame(speedKmh: Double) = controlFrame(OP_START, speedKmh, MODE_START)

    override fun speedFrame(speedKmh: Double) = controlFrame(OP_START, speedKmh, MODE_SPEED)

    override fun pauseFrame() = controlFrame(OP_PAUSE, 0.0, MODE_START)

    override fun stopFrame() = controlFrame(OP_STOP, 0.0, MODE_START)

    override fun newDecoder(): StatusDecoder {
        val reassembler = FrameReassembler()
        return StatusDecoder { _, data, timeMs -> reassembler.feed(data, timeMs).mapNotNull(::parseStatus) }
    }

    /** XOR of every byte between the start byte and the checksum byte. */
    fun checksum(frame: ByteArray): Byte {
        var value = 0
        for (i in 1 until frame.size - 2) value = value xor (frame[i].toInt() and 0xFF)
        return value.toByte()
    }

    fun isValidFrame(frame: ByteArray): Boolean =
        frame.size >= 5 && (frame[1].toInt() and 0xFF) == frame.size &&
            frame.last() == END.toByte() && frame[frame.size - 2] == checksum(frame)

    fun parseStatus(frame: ByteArray): TreadmillStatus? {
        if (frame.size < MIN_STATUS_LENGTH || !isValidFrame(frame)) return null
        fun u8(i: Int) = frame[i].toInt() and 0xFF
        fun u16(i: Int) = (u8(i) shl 8) or u8(i + 1)
        fun u32(i: Int) = (u16(i).toLong() shl 16) or u16(i + 2).toLong()
        val firmware = u8(25)
        val state = when (u8(26) and 0x18) {
            0x18 -> RunState.STARTING
            0x08 -> RunState.RUNNING
            0x10 -> RunState.PAUSED
            else -> RunState.STOPPED
        }
        return TreadmillStatus(
            state = state,
            speedKmh = u16(3) / 1000.0,
            targetSpeedKmh = u16(5) / 1000.0,
            distanceKm = u32(7) / 1000.0,
            durationSeconds = if (firmware > 19) u32(20) / 1000 else u32(20), // ms since firmware 20
            steps = u32(14),
            kcal = u16(18),
            maxSpeedKmh = u16(27).takeIf { it > 0 }?.let { it / 1000.0 },
        )
    }

    private fun controlFrame(op: Int, speedKmh: Double, mode: Int): ByteArray {
        val speed = if (op == OP_START) (speedKmh.coerceIn(speedRange) * 1000).roundToInt() else 0
        val frame = ByteArray(23)
        frame[0] = COMMAND_START.toByte()
        frame[1] = frame.size.toByte()
        frame[6] = (speed shr 8).toByte()
        frame[7] = speed.toByte()
        frame[8] = mode.toByte()
        frame[10] = WEIGHT_KG.toByte()
        frame[12] = op.toByte() // bit 3 clear = metric units
        for (i in 0 until 8) frame[13 + i] = (USER_ID shr (56 - 8 * i)).toByte()
        frame[21] = checksum(frame)
        frame[22] = END.toByte()
        return frame
    }
}
