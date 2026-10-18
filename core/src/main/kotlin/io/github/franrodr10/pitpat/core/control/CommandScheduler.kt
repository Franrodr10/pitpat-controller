package io.github.franrodr10.pitpat.core.control

enum class CommandKind { STOP, CONTROL, SPEED, KEEP_ALIVE }

class Command(val kind: CommandKind, val frame: ByteArray, val label: String)

/**
 * Decides which command is written next. The BLE link carries one write at a time, so commands
 * wait here: STOP jumps the queue and discards everything that was waiting, consecutive speed
 * changes collapse into the latest one, and keep-alives are only sent when nothing else is.
 */
class CommandScheduler {
    private val pending = ArrayDeque<Command>()

    val isEmpty: Boolean get() = pending.isEmpty()

    fun submit(command: Command) {
        when (command.kind) {
            CommandKind.STOP -> {
                pending.clear()
                pending.addFirst(command)
            }
            CommandKind.SPEED ->
                if (pending.lastOrNull()?.kind == CommandKind.SPEED) pending[pending.lastIndex] = command
                else pending.addLast(command)
            CommandKind.CONTROL -> pending.addLast(command)
            CommandKind.KEEP_ALIVE -> if (pending.isEmpty()) pending.addLast(command)
        }
    }

    fun next(): Command? = pending.removeFirstOrNull()

    fun clear() = pending.clear()
}
