package io.github.franrodr10.pitpat.core.control

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CommandSchedulerTest {
    private fun command(kind: CommandKind, label: String) = Command(kind, ByteArray(0), label)

    private fun CommandScheduler.drain() = generateSequence { next() }.map { it.label }.toList()

    @Test
    fun `STOP goes first and discards what was waiting`() {
        val scheduler = CommandScheduler()
        scheduler.submit(command(CommandKind.CONTROL, "start"))
        scheduler.submit(command(CommandKind.SPEED, "speed"))
        scheduler.submit(command(CommandKind.STOP, "stop"))
        scheduler.submit(command(CommandKind.CONTROL, "start again"))
        assertEquals(listOf("stop", "start again"), scheduler.drain())
    }

    @Test
    fun `consecutive speed changes collapse into the latest`() {
        val scheduler = CommandScheduler()
        scheduler.submit(command(CommandKind.SPEED, "3.0"))
        scheduler.submit(command(CommandKind.SPEED, "3.5"))
        scheduler.submit(command(CommandKind.CONTROL, "pause"))
        scheduler.submit(command(CommandKind.SPEED, "4.0"))
        assertEquals(listOf("3.5", "pause", "4.0"), scheduler.drain())
    }

    @Test
    fun `keep-alive is only queued when nothing else is waiting`() {
        val scheduler = CommandScheduler()
        scheduler.submit(command(CommandKind.CONTROL, "start"))
        scheduler.submit(command(CommandKind.KEEP_ALIVE, "keep-alive"))
        assertEquals(listOf("start"), scheduler.drain())
        scheduler.submit(command(CommandKind.KEEP_ALIVE, "keep-alive"))
        scheduler.submit(command(CommandKind.KEEP_ALIVE, "keep-alive"))
        assertEquals(listOf("keep-alive"), scheduler.drain())
        assertNull(scheduler.next())
    }
}
