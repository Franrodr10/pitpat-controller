package io.github.franrodr10.pitpat.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.franrodr10.pitpat.PitPatApp
import io.github.franrodr10.pitpat.ble.BlePermissions
import io.github.franrodr10.pitpat.ble.BleScanner
import io.github.franrodr10.pitpat.session.DiagnosticsLog
import io.github.franrodr10.pitpat.session.SupportedProtocols
import io.github.franrodr10.pitpat.session.TreadmillManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class AppViewModel(application: Application) : AndroidViewModel(application) {

    enum class Screen { CONTROL, DEVICES, SETTINGS, LOG }

    private val app = application as PitPatApp
    val manager: TreadmillManager = app.manager
    val log: DiagnosticsLog get() = manager.log
    val scanner = BleScanner(application, SupportedProtocols.all)

    private val _screen = MutableStateFlow(if (app.settings.deviceAddress == null) Screen.DEVICES else Screen.CONTROL)
    val screen: StateFlow<Screen> = _screen.asStateFlow()

    private val _permissionsGranted = MutableStateFlow(BlePermissions.granted(application))
    val permissionsGranted: StateFlow<Boolean> = _permissionsGranted.asStateFlow()

    private val _presets = MutableStateFlow(app.settings.presets)
    val presets: StateFlow<List<Double>> = _presets.asStateFlow()

    private val _keepAlive = MutableStateFlow(app.settings.keepAliveEnabled)
    val keepAlive: StateFlow<Boolean> = _keepAlive.asStateFlow()

    init {
        // The device list must scan again when Bluetooth comes back on.
        viewModelScope.launch {
            manager.state.map { it.bluetoothOn }.distinctUntilChanged().collect { on ->
                if (on && _screen.value == Screen.DEVICES && _permissionsGranted.value) scanner.start()
            }
        }
    }

    /** Activity started, or the permission dialog closed. */
    fun onForeground() {
        val granted = BlePermissions.granted(app)
        _permissionsGranted.value = granted
        if (!granted) return
        manager.onForeground()
        if (_screen.value == Screen.DEVICES) scanner.start()
    }

    fun onBackground() {
        scanner.stop()
        manager.onBackground()
    }

    fun navigate(screen: Screen) {
        _screen.value = screen
        if (screen == Screen.DEVICES) scanner.start() else scanner.stop()
    }

    fun choose(device: BleScanner.Found) {
        scanner.stop()
        manager.connect(device.address, device.name, device.protocol.name)
        _screen.value = Screen.CONTROL
    }

    fun forgetDevice() {
        manager.forget()
        navigate(Screen.DEVICES)
    }

    fun savePresets(values: List<Double>) {
        app.settings.presets = values
        _presets.value = values
    }

    fun setKeepAlive(enabled: Boolean) {
        app.settings.keepAliveEnabled = enabled
        _keepAlive.value = enabled
    }

    override fun onCleared() {
        scanner.stop()
        manager.onAppClosed()
    }
}
