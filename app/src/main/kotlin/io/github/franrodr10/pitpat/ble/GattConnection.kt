package io.github.franrodr10.pitpat.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.os.Handler
import io.github.franrodr10.pitpat.core.protocol.TreadmillProtocol
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

/**
 * One GATT session with a treadmill: connect, raise the MTU, discover services and subscribe to
 * the status characteristics; then write command frames one at a time.
 *
 * Android allows a single GATT operation in flight, so every request waits for its callback (or a
 * timeout) before the next one starts. Bluetooth callbacks arrive on [handler]'s thread and every
 * method must be called from that same thread, so no locking is needed.
 */
@SuppressLint("MissingPermission") // only created after BlePermissions.granted()
class GattConnection(
    private val context: Context,
    private val device: BluetoothDevice,
    private val protocol: TreadmillProtocol,
    private val handler: Handler,
    private val listener: Listener,
) {
    interface Listener {
        fun onData(characteristic: UUID, value: ByteArray)

        /** The link went down after [open] succeeded. Not called after [close]. */
        fun onDisconnected(status: Int)
    }

    enum class WriteResult { OK, TIMEOUT, BUSY, FAILED, NOT_CONNECTED }

    open class GattException(message: String) : Exception(message)

    class IncompatibleDeviceException(message: String) : GattException(message)

    var mtu = DEFAULT_MTU
        private set

    private var gatt: BluetoothGatt? = null
    private var commandCharacteristic: BluetoothGattCharacteristic? = null
    private var linkUp: CompletableDeferred<Unit>? = null
    private val mtuOp = Operation()
    private val discoveryOp = Operation()
    private val descriptorOp = Operation()
    private val writeOp = Operation()
    private var ready = false
    private var closed = false

    /** Connects and prepares the link. Throws [GattException] on failure; call [close] afterwards. */
    suspend fun open() {
        val connected = CompletableDeferred<Unit>()
        linkUp = connected
        val g = device.connectGatt(
            context, false, callback, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, handler,
        ) ?: throw GattException("Android no pudo iniciar la conexión")
        gatt = g
        withTimeoutOrNull(CONNECT_TIMEOUT_MS) { connected.await() } ?: throw GattException("la cinta no responde")

        // Short connection interval: the treadmill drops idle links with the default parameters.
        g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
        delay(SETTLE_MS)
        // A larger MTU lets a whole status frame fit in one notification; the decoder copes without.
        mtuOp.run(OP_TIMEOUT_MS) { g.requestMtu(MAX_MTU) }

        val discovery = discoveryOp.run(DISCOVERY_TIMEOUT_MS) { g.discoverServices() }
        if (discovery != BluetoothGatt.GATT_SUCCESS) throw GattException("no se pudieron leer los servicios (${describe(discovery)})")
        val service = g.getService(protocol.service)
            ?: throw IncompatibleDeviceException("el dispositivo no tiene el servicio ${protocol.service}")
        commandCharacteristic = service.getCharacteristic(protocol.commandCharacteristic)
            ?: throw IncompatibleDeviceException("falta la característica de comandos ${protocol.commandCharacteristic}")
        for (uuid in protocol.statusCharacteristics) {
            val characteristic = service.getCharacteristic(uuid)
                ?: throw IncompatibleDeviceException("falta la característica de estado $uuid")
            enableUpdates(g, characteristic)
        }
        ready = true
    }

    /** Writes one command frame and waits until the treadmill acknowledges it. */
    suspend fun write(frame: ByteArray): WriteResult {
        val g = gatt
        val characteristic = commandCharacteristic
        if (g == null || characteristic == null || !ready || closed) return WriteResult.NOT_CONNECTED
        return try {
            repeat(BUSY_RETRIES) {
                when (writeOp.run(WRITE_TIMEOUT_MS) { startWrite(g, characteristic, frame) }) {
                    BluetoothGatt.GATT_SUCCESS -> return WriteResult.OK
                    Operation.NOT_STARTED -> delay(BUSY_RETRY_MS) // the stack is still busy with a late callback
                    Operation.TIMED_OUT -> return WriteResult.TIMEOUT
                    else -> return WriteResult.FAILED
                }
            }
            WriteResult.BUSY
        } catch (_: GattException) {
            WriteResult.NOT_CONNECTED
        } catch (_: SecurityException) {
            WriteResult.FAILED
        }
    }

    fun close() {
        if (closed) return
        closed = true
        ready = false
        val g = gatt ?: return
        gatt = null
        try {
            g.disconnect()
            g.close()
        } catch (_: SecurityException) {
            // Permission revoked: Android has already dropped the link.
        }
    }

    private suspend fun enableUpdates(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        if (!g.setCharacteristicNotification(characteristic, true)) {
            throw GattException("no se pudieron activar las notificaciones de ${characteristic.uuid}")
        }
        val cccd = characteristic.getDescriptor(CCCD) ?: return
        val value = if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) {
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        } else {
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        }
        val status = descriptorOp.run(OP_TIMEOUT_MS) { writeDescriptor(g, cccd, value) }
        if (status != BluetoothGatt.GATT_SUCCESS) throw GattException("no se pudieron activar las notificaciones (${describe(status)})")
    }

    private fun writeDescriptor(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, value: ByteArray): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS
        } else {
            legacyWriteDescriptor(g, descriptor, value)
        }

    private fun startWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, frame: ByteArray): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeCharacteristic(characteristic, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
                BluetoothStatusCodes.SUCCESS
        } else {
            legacyWriteCharacteristic(g, characteristic, frame)
        }

    @Suppress("DEPRECATION")
    private fun legacyWriteDescriptor(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, value: ByteArray): Boolean {
        descriptor.value = value
        return g.writeDescriptor(descriptor)
    }

    @Suppress("DEPRECATION")
    private fun legacyWriteCharacteristic(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, frame: ByteArray): Boolean {
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        characteristic.value = frame
        return g.writeCharacteristic(characteristic)
    }

    private fun deliver(uuid: UUID, value: ByteArray) {
        if (!closed) listener.onData(uuid, value.copyOf())
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (status == BluetoothGatt.GATT_SUCCESS) linkUp?.complete(Unit) else g.disconnect()
                return
            }
            if (newState != BluetoothProfile.STATE_DISCONNECTED) return
            val cause = GattException("conexión cerrada (${describe(status)})")
            linkUp?.completeExceptionally(cause)
            for (op in listOf(mtuOp, discoveryOp, descriptorOp, writeOp)) op.fail(cause)
            val wasReady = ready
            close()
            if (wasReady) listener.onDisconnected(status)
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) this@GattConnection.mtu = mtu
            mtuOp.complete(status)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = discoveryOp.complete(status)

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) =
            descriptorOp.complete(status)

        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) =
            writeOp.complete(status)

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) =
            deliver(characteristic.uuid, value)

        @Deprecated("Android 12 and older call this instead of the method above")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            val value = characteristic.value ?: return
            deliver(characteristic.uuid, value)
        }
    }

    /** One GATT request in flight and the callback that completes it. */
    private class Operation {
        private var result: CompletableDeferred<Int>? = null

        /** Returns the callback status, [NOT_STARTED] if Android refused the request or [TIMED_OUT]. */
        suspend fun run(timeoutMs: Long, start: () -> Boolean): Int {
            val deferred = CompletableDeferred<Int>()
            result = deferred
            try {
                if (!start()) return NOT_STARTED
                return withTimeoutOrNull(timeoutMs) { deferred.await() } ?: TIMED_OUT
            } finally {
                if (result === deferred) result = null
            }
        }

        fun complete(status: Int) {
            result?.complete(status)
        }

        fun fail(cause: Throwable) {
            result?.completeExceptionally(cause)
        }

        companion object {
            const val NOT_STARTED = -1
            const val TIMED_OUT = -2
        }
    }

    companion object {
        private const val DEFAULT_MTU = 23
        private const val MAX_MTU = 517
        private const val CONNECT_TIMEOUT_MS = 12_000L
        private const val SETTLE_MS = 200L
        private const val OP_TIMEOUT_MS = 3_000L
        private const val DISCOVERY_TIMEOUT_MS = 10_000L
        private const val WRITE_TIMEOUT_MS = 1_500L
        private const val BUSY_RETRIES = 20
        private const val BUSY_RETRY_MS = 25L
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        /** Human-readable GATT status for the diagnostics log. */
        fun describe(status: Int): String = when (status) {
            BluetoothGatt.GATT_SUCCESS -> "correcto"
            8 -> "8: la cinta dejó de responder"
            19 -> "19: la cinta cerró la conexión"
            22 -> "22: el móvil cerró la conexión"
            62 -> "62: no se pudo establecer"
            133 -> "133: error GATT"
            Operation.NOT_STARTED -> "Android rechazó la petición"
            Operation.TIMED_OUT -> "sin respuesta"
            else -> "estado $status"
        }
    }
}
