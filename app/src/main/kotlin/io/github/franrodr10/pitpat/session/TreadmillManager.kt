package io.github.franrodr10.pitpat.session

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.core.content.ContextCompat
import io.github.franrodr10.pitpat.ble.BlePermissions
import io.github.franrodr10.pitpat.ble.GattConnection
import io.github.franrodr10.pitpat.ble.GattConnection.WriteResult
import io.github.franrodr10.pitpat.core.control.Command
import io.github.franrodr10.pitpat.core.control.CommandKind
import io.github.franrodr10.pitpat.core.control.CommandScheduler
import io.github.franrodr10.pitpat.core.control.SessionController
import io.github.franrodr10.pitpat.core.control.StepEstimator
import io.github.franrodr10.pitpat.core.protocol.RunState
import io.github.franrodr10.pitpat.core.protocol.StatusDecoder
import io.github.franrodr10.pitpat.core.protocol.TreadmillProtocol
import io.github.franrodr10.pitpat.core.protocol.TreadmillStatus
import io.github.franrodr10.pitpat.core.protocol.toHex
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.android.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID
import kotlin.math.roundToInt

/**
 * Owns the link with the treadmill for the whole app (it outlives the activity) and exposes its
 * state to the UI.
 *
 * Safety rules live in [SessionController]; this class adds the transport side: one write at a
 * time with STOP first, keep-alive, a watchdog for silent links, and reconnection with a vibration
 * and a visible alert when the link drops. Nothing is resent after reconnecting.
 *
 * All mutable state is confined to a dedicated Bluetooth thread; public methods only post to it.
 */
@SuppressLint("MissingPermission") // Bluetooth is only used after BlePermissions.granted()
class TreadmillManager(
    private val context: Context,
    private val settings: Settings,
    val log: DiagnosticsLog,
    private val haptics: Haptics,
    appVersion: String,
) {
    enum class Link { NO_DEVICE, DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

    enum class Alert { LINK_LOST, LINK_LOST_WHILE_MOVING, STOP_NOT_CONFIRMED }

    enum class Message { NOT_CONNECTED, NO_DATA, RECONNECTED, INCOMPATIBLE }

    data class State(
        val link: Link,
        val deviceName: String?,
        val attempt: Int = 0,
        val bluetoothOn: Boolean,
        val status: TreadmillStatus? = null,
        val fresh: Boolean = false,
        val steps: StepEstimator.Steps? = null,
        val targetKmh: Double,
        val speedRange: ClosedFloatingPointRange<Double>,
        val alert: Alert? = null,
    ) {
        val isActive: Boolean get() = link == Link.CONNECTING || link == Link.CONNECTED || link == Link.RECONNECTING
    }

    private val adapter: BluetoothAdapter? = context.getSystemService(BluetoothManager::class.java)?.adapter
    private val bleThread = HandlerThread("pitpat-ble").apply { start() }
    private val handler = Handler(bleThread.looper)
    private val scope = CoroutineScope(SupervisorJob() + handler.asCoroutineDispatcher())

    // Only touched on the Bluetooth thread.
    private var protocol: TreadmillProtocol = SupportedProtocols.byName(settings.protocolName)
    private var controller = SessionController(protocol, settings.targetKmh)
    private val scheduler = CommandScheduler()
    private val wakeWriter = Channel<Unit>(Channel.CONFLATED)
    private val stepEstimator = StepEstimator()
    private val incomingLog = IncomingLog()
    private var decoder: StatusDecoder? = null
    private var session: Job? = null
    private var linkLost: CompletableDeferred<Unit>? = null
    private var writing = false
    private var lastDataAtMs = 0L
    private var stopFailures = 0

    private val _state = MutableStateFlow(
        State(
            link = if (settings.deviceAddress == null) Link.NO_DEVICE else Link.DISCONNECTED,
            deviceName = settings.deviceName,
            bluetoothOn = adapter?.isEnabled == true,
            targetKmh = controller.targetKmh,
            speedRange = controller.speedRange,
        ),
    )
    val state: StateFlow<State> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<Message>(extraBufferCapacity = 8)
    val messages: SharedFlow<Message> = _messages.asSharedFlow()

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val on = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR) == BluetoothAdapter.STATE_ON
            if (on != _state.value.bluetoothOn) log.add(if (on) "Bluetooth activado" else "Bluetooth desactivado")
            _state.update { it.copy(bluetoothOn = on) }
        }
    }

    init {
        ContextCompat.registerReceiver(
            context, bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        log.add("PitPat Controller $appVersion · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}")
    }

    // ------------------------------------------------------------------ public API (any thread)

    fun connect(address: String, name: String?, protocolName: String) = onBle {
        settings.saveDevice(address, name, protocolName)
        if (protocol.name != protocolName) {
            protocol = SupportedProtocols.byName(protocolName)
            controller = SessionController(protocol, controller.targetKmh)
        }
        _state.update { it.copy(deviceName = name, alert = null) }
        startSession()
    }

    /** The app came to the foreground: reconnect to the remembered treadmill if needed. */
    fun onForeground() = onBle {
        _state.update { it.copy(bluetoothOn = adapter?.isEnabled == true) }
        if (session?.isActive != true && settings.deviceAddress != null) startSession()
    }

    /** The app went to the background: keep a live link, but stop retrying a dead one. */
    fun onBackground() = onBle {
        if (_state.value.link != Link.CONNECTED) stopSession()
    }

    /** The activity was closed for good: let the treadmill go unless the belt is moving. */
    fun onAppClosed() = onBle {
        if (_state.value.status?.isMoving != true) stopSession()
    }

    fun reconnect() = onBle { if (settings.deviceAddress != null) startSession() }

    fun forget() = onBle {
        stopSession()
        settings.forgetDevice()
        _state.update { it.copy(link = Link.NO_DEVICE, deviceName = null) }
    }

    fun startOrPause() = onBle { handle(controller.startOrPause(isConnected(), now())) }

    fun stop() = onBle {
        val outcome = controller.stop(isConnected(), now())
        if (outcome.notice == SessionController.Notice.NOT_CONNECTED) haptics.alert()
        handle(outcome)
    }

    fun changeSpeed(deltaKmh: Double) = onBle { handle(controller.changeSpeed(deltaKmh, isConnected(), now())) }

    fun selectSpeed(kmh: Double) = onBle { handle(controller.selectSpeed(kmh, isConnected(), now())) }

    fun dismissAlert() = onBle { _state.update { it.copy(alert = null) } }

    private fun onBle(block: suspend () -> Unit) {
        scope.launch { block() }
    }

    // ------------------------------------------------------------------ session

    private fun isConnected() = _state.value.link == Link.CONNECTED

    private fun now() = SystemClock.elapsedRealtime()

    private suspend fun startSession() {
        session?.cancelAndJoin()
        session = scope.launch { runSession() }
    }

    private suspend fun stopSession() {
        session?.cancelAndJoin()
        session = null
        _state.update {
            it.copy(
                link = if (settings.deviceAddress == null) Link.NO_DEVICE else Link.DISCONNECTED,
                attempt = 0, status = null, fresh = false, steps = null, alert = null,
            )
        }
    }

    /** Connects, then reconnects with backoff every time the link drops, until cancelled. */
    private suspend fun runSession() {
        val address = settings.deviceAddress ?: return
        var attempt = 0
        while (true) {
            _state.update { it.copy(link = if (attempt == 0) Link.CONNECTING else Link.RECONNECTING, attempt = attempt) }
            val bluetooth = adapter
            if (bluetooth == null || !bluetooth.isEnabled || !BlePermissions.granted(context)) {
                delay(1_000) // the UI is asking for Bluetooth or the permission meanwhile
                continue
            }
            var connection: GattConnection? = null
            var linkWasUp = false
            try {
                connection = GattConnection(context, bluetooth.getRemoteDevice(address), protocol, handler, gattListener)
                log.add("Conectando con ${settings.deviceName ?: protocol.name}…")
                connection.open()
                linkWasUp = true
                attempt = 0
                onConnected(connection)
                awaitLinkLoss(connection)
            } catch (e: GattConnection.IncompatibleDeviceException) {
                log.add("!! Dispositivo incompatible: ${e.message}")
                _messages.tryEmit(Message.INCOMPATIBLE)
                _state.update { it.copy(link = Link.DISCONNECTED, attempt = 0) }
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.add("!! No se pudo conectar: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                connection?.close()
                if (linkWasUp) onLinkDown(byUser = !currentCoroutineContext().isActive)
            }
            attempt++
            // Not connected any more from this moment: STOP must warn instead of queuing silently.
            _state.update { it.copy(link = Link.RECONNECTING, attempt = attempt) }
            delay(minOf(1_000L shl minOf(attempt - 1, 4), MAX_BACKOFF_MS))
        }
    }

    private val gattListener = object : GattConnection.Listener {
        override fun onData(characteristic: UUID, value: ByteArray) = onIncoming(characteristic, value)

        override fun onDisconnected(status: Int) {
            log.add("!! Conexión perdida (${GattConnection.describe(status)})")
            linkLost?.complete(Unit)
        }
    }

    private fun onConnected(connection: GattConnection) {
        decoder = protocol.newDecoder()
        stepEstimator.reset()
        scheduler.clear()
        incomingLog.reset()
        lastDataAtMs = now()
        val previous = _state.value.alert
        val wasLost = previous == Alert.LINK_LOST || previous == Alert.LINK_LOST_WHILE_MOVING
        log.add("Conectado (MTU ${connection.mtu}, heartbeat ${if (settings.keepAliveEnabled) "activado" else "desactivado"})")
        _state.update { it.copy(link = Link.CONNECTED, attempt = 0, alert = if (wasLost) null else it.alert) }
        if (wasLost) _messages.tryEmit(Message.RECONNECTED)
    }

    /** Runs the writer, keep-alive and watchdog until the link is lost. */
    private suspend fun awaitLinkLoss(connection: GattConnection) = coroutineScope {
        val lost = CompletableDeferred<Unit>()
        linkLost = lost
        val workers = listOf(
            launch { writerLoop(connection) },
            launch { keepAliveLoop() },
            launch { watchdogLoop(lost) },
        )
        try {
            lost.await()
        } finally {
            workers.forEach { it.cancel() }
            linkLost = null
        }
    }

    /** Forgets everything pending: after a reconnection nothing is resent on its own. */
    private fun onLinkDown(byUser: Boolean) {
        val wasMoving = _state.value.status?.isMoving == true
        scheduler.clear()
        controller.onLinkDown()
        decoder = null
        _state.update { it.copy(status = null, fresh = false, steps = null, speedRange = controller.speedRange) }
        if (!byUser) {
            _state.update { it.copy(alert = if (wasMoving) Alert.LINK_LOST_WHILE_MOVING else Alert.LINK_LOST) }
            haptics.alert()
        }
    }

    // ------------------------------------------------------------------ data in, commands out

    private fun onIncoming(characteristic: UUID, value: ByteArray) {
        val now = now()
        lastDataAtMs = now
        val statuses = decoder?.decode(characteristic, value, now).orEmpty()
        incomingLog.line(value, statuses.lastOrNull(), now)?.let(log::add)
        for (status in statuses) {
            handle(controller.onStatus(status, now))
            val steps = stepEstimator.update(status)
            _state.update {
                it.copy(
                    status = status, fresh = true, steps = steps,
                    alert = if (it.alert == Alert.STOP_NOT_CONFIRMED && !status.isMoving) null else it.alert,
                )
            }
        }
    }

    private fun handle(outcome: SessionController.Outcome) {
        if (outcome.commands.isNotEmpty()) {
            outcome.commands.forEach(scheduler::submit)
            wakeWriter.trySend(Unit)
        }
        when (outcome.notice) {
            SessionController.Notice.NOT_CONNECTED -> _messages.tryEmit(Message.NOT_CONNECTED)
            SessionController.Notice.NO_DATA -> _messages.tryEmit(Message.NO_DATA)
            SessionController.Notice.STOP_NOT_CONFIRMED -> stopNotConfirmed()
            null -> Unit
        }
        settings.targetKmh = controller.targetKmh
        _state.update { it.copy(targetKmh = controller.targetKmh, speedRange = controller.speedRange) }
    }

    private fun stopNotConfirmed() {
        log.add("!! La cinta no confirma la parada")
        _state.update { it.copy(alert = Alert.STOP_NOT_CONFIRMED) }
        haptics.alert()
    }

    private suspend fun writerLoop(connection: GattConnection) {
        while (true) {
            val command = scheduler.next()
            if (command == null) {
                wakeWriter.receive()
                continue
            }
            writing = true
            val result = try {
                connection.write(command.frame)
            } finally {
                writing = false
            }
            if (command.kind != CommandKind.KEEP_ALIVE || result != WriteResult.OK) {
                log.add("-> ${command.frame.toHex()} (${command.label}) ${result.name.lowercase(Locale.ROOT)}")
            }
            if (command.kind == CommandKind.STOP) onStopWritten(command, result)
        }
    }

    private suspend fun onStopWritten(command: Command, result: WriteResult) {
        if (result == WriteResult.OK) {
            stopFailures = 0
            return
        }
        stopFailures++
        if (stopFailures <= MAX_STOP_RETRIES) {
            delay(100)
            scheduler.submit(command)
        } else {
            stopFailures = 0
            stopNotConfirmed()
        }
    }

    private suspend fun keepAliveLoop() {
        val frame = protocol.keepAliveFrame ?: return
        while (true) {
            delay(protocol.keepAliveIntervalMs)
            if (settings.keepAliveEnabled && !writing && scheduler.isEmpty) {
                scheduler.submit(Command(CommandKind.KEEP_ALIVE, frame, "keep-alive"))
                wakeWriter.trySend(Unit)
            }
        }
    }

    /** Some links die without Android noticing for a long time: no data for a while means lost. */
    private suspend fun watchdogLoop(lost: CompletableDeferred<Unit>) {
        while (true) {
            delay(1_000)
            val now = now()
            val fresh = controller.hasFreshStatus(now)
            if (_state.value.fresh != fresh) _state.update { it.copy(fresh = fresh) }
            val silentMs = now - lastDataAtMs
            if (silentMs > WATCHDOG_MS) {
                log.add("!! Sin datos de la cinta durante ${silentMs / 1000} s: se reinicia la conexión")
                lost.complete(Unit)
                return
            }
        }
    }

    /** Keeps the diagnostics log readable: frames are logged when something but the counters changes. */
    private class IncomingLog {
        private var lastKey: String? = null
        private var lastAtMs = 0L
        private var skipped = 0
        private var undecoded = 0

        fun reset() {
            lastKey = null
            skipped = 0
            undecoded = 0
        }

        fun line(raw: ByteArray, status: TreadmillStatus?, nowMs: Long): String? {
            if (status == null) {
                undecoded++
                return if (undecoded <= 20 || undecoded % 50 == 0) "<- ${raw.toHex()}" else null
            }
            val key = "${status.state}/${status.targetSpeedKmh}/${(status.speedKmh * 10).roundToInt()}"
            if (key == lastKey && nowMs - lastAtMs < 5_000) {
                skipped++
                return null
            }
            val extra = if (skipped > 0) " (+$skipped)" else ""
            lastKey = key
            lastAtMs = nowMs
            skipped = 0
            return "<- ${raw.toHex()} | ${describe(status)}$extra"
        }

        private fun describe(s: TreadmillStatus): String {
            val state = when (s.state) {
                RunState.STOPPED -> "parada"
                RunState.STARTING -> "cuenta atrás"
                RunState.RUNNING -> "en marcha"
                RunState.PAUSED -> "en pausa"
            }
            return String.format(
                Locale.ROOT, "%s v=%.2f obj=%.2f d=%.3f t=%d pasos=%d kcal=%d máx=%s",
                state, s.speedKmh, s.targetSpeedKmh, s.distanceKm, s.durationSeconds, s.steps, s.kcal,
                s.maxSpeedKmh?.toString() ?: "-",
            )
        }
    }

    private companion object {
        const val WATCHDOG_MS = 10_000L
        const val MAX_BACKOFF_MS = 10_000L
        const val MAX_STOP_RETRIES = 3
    }
}
