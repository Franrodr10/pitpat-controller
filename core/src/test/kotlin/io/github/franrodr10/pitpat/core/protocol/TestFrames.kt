package io.github.franrodr10.pitpat.core.protocol

/** Builds synthetic 52-byte PitPat status frames for tests. */
object TestFrames {
    fun status(
        flags: Int = 0x08,
        speed: Int = 3500,
        target: Int = speed,
        distanceM: Long = 1234,
        steps: Long = 1520,
        kcal: Int = 56,
        durationRaw: Long = 754_000,
        firmware: Int = 27,
        maxSpeed: Int = 6000,
    ): ByteArray {
        val frame = ByteArray(52)
        frame[0] = 0x68
        frame[1] = frame.size.toByte()
        put(frame, 3, speed.toLong(), 2)
        put(frame, 5, target.toLong(), 2)
        put(frame, 7, distanceM, 4)
        put(frame, 14, steps, 4)
        put(frame, 18, kcal.toLong(), 2)
        put(frame, 20, durationRaw, 4)
        frame[25] = firmware.toByte()
        frame[26] = flags.toByte()
        put(frame, 27, maxSpeed.toLong(), 2)
        frame[50] = PitPatProtocol.checksum(frame)
        frame[51] = 0x43
        return frame
    }

    private fun put(frame: ByteArray, offset: Int, value: Long, size: Int) {
        for (i in 0 until size) frame[offset + i] = (value shr (8 * (size - 1 - i))).toByte()
    }
}
