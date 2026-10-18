package io.github.franrodr10.pitpat.core.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PitPatProtocolTest {

    @Test
    fun `control frames match the documented examples`() {
        assertEquals("6A 17 00 00 00 00 07 D0 01 00 50 00 04 00 00 00 0D BA 9D 76 EF 26 43", PitPatProtocol.startFrame(2.0).toHex())
        assertEquals("6A 17 00 00 00 00 0B B8 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 46 43", PitPatProtocol.speedFrame(3.0).toHex())
        assertEquals("6A 17 00 00 00 00 11 94 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 70 43", PitPatProtocol.speedFrame(4.5).toHex())
        assertEquals("6A 17 00 00 00 00 00 00 01 00 50 00 02 00 00 00 0D BA 9D 76 EF F7 43", PitPatProtocol.pauseFrame().toHex())
        assertEquals("6A 17 00 00 00 00 00 00 01 00 50 00 00 00 00 00 0D BA 9D 76 EF F5 43", PitPatProtocol.stopFrame().toHex())
        assertEquals("6A 05 FD F8 43", PitPatProtocol.keepAliveFrame.toHex())
    }

    @Test
    fun `speed frames never leave the protocol range`() {
        assertContentEquals(PitPatProtocol.speedFrame(6.0), PitPatProtocol.speedFrame(9.9))
        assertContentEquals(PitPatProtocol.startFrame(1.0), PitPatProtocol.startFrame(0.2))
        assertContentEquals(PitPatProtocol.startFrame(1.0), PitPatProtocol.startFrame(-3.0))
    }

    @Test
    fun `checksum agrees with frames published by other projects`() {
        for (frame in listOf("6A05FDF843", "6A05D7D243", "6B059D9843", "6A1700000000000005008A00020000000000122E0CAA43")) {
            assertTrue(PitPatProtocol.isValidFrame(hex(frame)), frame)
        }
    }

    @Test
    fun `parses the example status frame from PROTOCOL_md`() {
        val frame = hex(
            "68 34 00 0D AC 0D AC 00 00 04 D2 00 00 00 00 00 05 F0 00 38 00 0B 81 50" +
                "2A 1B 08 17 70 00 05 00 45 58 41 4D 50 4C 45 2D 53 45 52 49 41 4C 30 30 00 00 CB 43",
        )
        val status = PitPatProtocol.parseStatus(frame)
        assertEquals(
            TreadmillStatus(
                state = RunState.RUNNING, speedKmh = 3.5, targetSpeedKmh = 3.5, distanceKm = 1.234,
                durationSeconds = 754, steps = 1520, kcal = 56, maxSpeedKmh = 6.0,
            ),
            status,
        )
    }

    @Test
    fun `decodes every run state`() {
        val states = mapOf(0x00 to RunState.STOPPED, 0x18 to RunState.STARTING, 0x08 to RunState.RUNNING, 0x10 to RunState.PAUSED)
        for ((flags, state) in states) {
            // Other flag bits (units, Wi-Fi, bracelet) must not change the state.
            assertEquals(state, PitPatProtocol.parseStatus(TestFrames.status(flags = flags or 0xE1))?.state)
        }
    }

    @Test
    fun `duration is in seconds on firmware 19 and older`() {
        assertEquals(754, PitPatProtocol.parseStatus(TestFrames.status(durationRaw = 754, firmware = 19))?.durationSeconds)
        assertEquals(754, PitPatProtocol.parseStatus(TestFrames.status(durationRaw = 754_999, firmware = 20))?.durationSeconds)
    }

    @Test
    fun `rejects corrupted and short frames`() {
        val frame = TestFrames.status()
        val corrupted = frame.copyOf().also { it[4] = (it[4] + 1).toByte() }
        assertNull(PitPatProtocol.parseStatus(corrupted))
        assertNull(PitPatProtocol.parseStatus(frame.copyOfRange(0, 30)))
        assertNull(PitPatProtocol.parseStatus(PitPatProtocol.keepAliveFrame))
    }

    @Test
    fun `decoder reassembles notifications split by the default MTU`() {
        val decoder = PitPatProtocol.newDecoder()
        val frame = TestFrames.status(speed = 4200)
        val statuses = frame.toList().chunked(20).flatMap { decoder.decode(PitPatProtocol.statusCharacteristics[0], it.toByteArray(), 0) }
        assertEquals(listOf(4.2), statuses.map { it.speedKmh })
    }

    @Test
    fun `recognises PitPat advertisements`() {
        assertTrue(PitPatProtocol.matchesAdvertisement("PitPat-T01", emptyList()))
        assertTrue(PitPatProtocol.matchesAdvertisement(null, listOf(uuid16(0xFBA0))))
        assertTrue(PitPatProtocol.matchesAdvertisement("", listOf(uuid16(0x1910))))
        assertFalse(PitPatProtocol.matchesAdvertisement("Walkingpad", listOf(uuid16(0x1826))))
    }

    private fun hex(text: String) = text.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
