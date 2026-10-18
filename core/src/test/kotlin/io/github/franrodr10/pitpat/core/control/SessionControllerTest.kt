package io.github.franrodr10.pitpat.core.control

import io.github.franrodr10.pitpat.core.control.SessionController.Notice
import io.github.franrodr10.pitpat.core.protocol.PitPatProtocol
import io.github.franrodr10.pitpat.core.protocol.RunState
import io.github.franrodr10.pitpat.core.protocol.RunState.PAUSED
import io.github.franrodr10.pitpat.core.protocol.RunState.RUNNING
import io.github.franrodr10.pitpat.core.protocol.RunState.STARTING
import io.github.franrodr10.pitpat.core.protocol.RunState.STOPPED
import io.github.franrodr10.pitpat.core.protocol.TreadmillStatus
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionControllerTest {
    private val protocol = PitPatProtocol

    private fun status(state: RunState, speed: Double = 0.0, target: Double = speed, max: Double? = 6.0) =
        TreadmillStatus(state, speed, target, distanceKm = 0.0, durationSeconds = 0, steps = 0, kcal = 0, maxSpeedKmh = max)

    private fun SessionController.Outcome.frame() = commands.single().frame

    @Test
    fun `without a connection nothing is sent and the user is told`() {
        val controller = SessionController(protocol, 2.0)
        assertEquals(Notice.NOT_CONNECTED, controller.stop(connected = false, nowMs = 0).notice)
        assertEquals(Notice.NOT_CONNECTED, controller.startOrPause(connected = false, nowMs = 0).notice)
        assertTrue(controller.selectSpeed(4.0, connected = false, nowMs = 0).commands.isEmpty())
        assertEquals(4.0, controller.targetKmh)
    }

    @Test
    fun `start needs fresh data from the treadmill`() {
        val controller = SessionController(protocol, 2.0)
        assertEquals(Notice.NO_DATA, controller.startOrPause(true, 0).notice)
        controller.onStatus(status(STOPPED), 0)
        assertEquals(Notice.NO_DATA, controller.startOrPause(true, 10_000).notice)
    }

    @Test
    fun `start sends the target and corrects it once if the treadmill uses its own speed`() {
        val controller = SessionController(protocol, 3.0)
        controller.onStatus(status(STOPPED), 0)
        assertContentEquals(protocol.startFrame(3.0), controller.startOrPause(true, 100).frame())
        assertTrue(controller.onStatus(status(STARTING), 1_000).commands.isEmpty())
        assertContentEquals(protocol.speedFrame(3.0), controller.onStatus(status(RUNNING, 1.0), 4_000).frame())
        assertTrue(controller.onStatus(status(RUNNING, 1.0), 4_500).commands.isEmpty())
    }

    @Test
    fun `no correction when the treadmill honours the start speed`() {
        val controller = SessionController(protocol, 3.0)
        controller.onStatus(status(PAUSED), 0)
        controller.startOrPause(true, 100)
        assertTrue(controller.onStatus(status(RUNNING, 3.0), 3_000).commands.isEmpty())
    }

    @Test
    fun `the main button pauses while running and does nothing during the countdown`() {
        val controller = SessionController(protocol, 3.0)
        controller.onStatus(status(STARTING), 0)
        assertTrue(controller.startOrPause(true, 100).commands.isEmpty())
        controller.onStatus(status(RUNNING, 3.0), 200)
        assertContentEquals(protocol.pauseFrame(), controller.startOrPause(true, 300).frame())
    }

    @Test
    fun `speed changes are only sent while running with fresh data`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(STOPPED), 0)
        assertTrue(controller.changeSpeed(0.5, true, 100).commands.isEmpty())
        assertEquals(2.5, controller.targetKmh)
        controller.onStatus(status(RUNNING, 2.5), 200)
        assertContentEquals(protocol.speedFrame(3.0), controller.changeSpeed(0.5, true, 300).frame())
        assertTrue(controller.changeSpeed(0.5, true, 10_000).commands.isEmpty())
    }

    @Test
    fun `speeds stay between the protocol minimum and the treadmill maximum`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(RUNNING, 3.0, max = 5.0), 0)
        assertContentEquals(protocol.speedFrame(5.0), controller.selectSpeed(9.0, true, 10).frame())
        assertContentEquals(protocol.speedFrame(1.0), controller.changeSpeed(-10.0, true, 20).frame())
        controller.changeSpeed(0.5, true, 30)
        controller.changeSpeed(0.1, true, 40)
        assertEquals(1.6, controller.targetKmh)
    }

    @Test
    fun `a speed chosen during the countdown is applied once running`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(STOPPED), 0)
        controller.startOrPause(true, 10)
        controller.onStatus(status(STARTING), 500)
        assertTrue(controller.selectSpeed(4.0, true, 600).commands.isEmpty())
        assertContentEquals(protocol.speedFrame(4.0), controller.onStatus(status(RUNNING, 2.0), 3_000).frame())
    }

    @Test
    fun `follows the remote control, but not right after a change in the app`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(RUNNING, 3.0), 0)
        assertEquals(3.0, controller.targetKmh)
        controller.selectSpeed(4.0, true, 1_000)
        controller.onStatus(status(RUNNING, 3.0), 1_500)
        assertEquals(4.0, controller.targetKmh)
        controller.onStatus(status(RUNNING, 3.6), 5_000)
        assertEquals(3.6, controller.targetKmh)
    }

    @Test
    fun `STOP is always sent, even with stale or no data`() {
        val controller = SessionController(protocol, 2.0)
        assertEquals(CommandKind.STOP, controller.stop(true, 0).commands.single().kind)
    }

    @Test
    fun `STOP is re-sent while the belt keeps moving, then the user is warned`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(RUNNING, 3.0), 0)
        controller.stop(true, 100)
        assertTrue(controller.onStatus(status(RUNNING, 3.0), 1_000).commands.isEmpty())
        assertEquals(CommandKind.STOP, controller.onStatus(status(RUNNING, 3.0), 3_200).commands.single().kind)
        assertEquals(CommandKind.STOP, controller.onStatus(status(RUNNING, 3.0), 6_300).commands.single().kind)
        val gaveUp = controller.onStatus(status(RUNNING, 3.0), 9_400)
        assertTrue(gaveUp.commands.isEmpty())
        assertEquals(Notice.STOP_NOT_CONFIRMED, gaveUp.notice)
    }

    @Test
    fun `a stopped belt ends the STOP checks`() {
        val controller = SessionController(protocol, 2.0)
        controller.onStatus(status(RUNNING, 3.0), 0)
        controller.stop(true, 100)
        controller.onStatus(status(STOPPED), 800)
        assertTrue(controller.onStatus(status(RUNNING, 1.0), 5_000).commands.isEmpty())
    }

    @Test
    fun `nothing pending survives a dropped link`() {
        val controller = SessionController(protocol, 3.0)
        controller.onStatus(status(STOPPED), 0)
        controller.startOrPause(true, 100)
        controller.onLinkDown()
        assertNull(controller.status)
        assertTrue(controller.onStatus(status(RUNNING, 1.0), 2_000).commands.isEmpty())
    }
}
