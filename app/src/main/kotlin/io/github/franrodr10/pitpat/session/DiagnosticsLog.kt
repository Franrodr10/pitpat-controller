package io.github.franrodr10.pitpat.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/** In-memory log of connection events and frames, shown in the app and shareable for debugging. */
class DiagnosticsLog(private val capacity: Int = 3_000) {
    private val lines = ArrayDeque<String>()
    private val clock = DateTimeFormatter.ofPattern("HH:mm:ss.SSS")
    private val _revision = MutableStateFlow(0)

    /** Changes every time the log changes, so the UI knows when to refresh. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    @Synchronized
    fun add(message: String) {
        lines.addLast("${LocalTime.now().format(clock)}  $message")
        while (lines.size > capacity) lines.removeFirst()
        _revision.update { it + 1 }
    }

    @Synchronized
    fun snapshot(): List<String> = lines.toList()

    @Synchronized
    fun clear() {
        lines.clear()
        _revision.update { it + 1 }
    }
}
