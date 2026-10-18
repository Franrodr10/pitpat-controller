package io.github.franrodr10.pitpat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.franrodr10.pitpat.R
import io.github.franrodr10.pitpat.core.control.StepEstimator
import io.github.franrodr10.pitpat.core.protocol.RunState
import io.github.franrodr10.pitpat.core.protocol.TreadmillStatus
import io.github.franrodr10.pitpat.session.TreadmillManager.Alert
import io.github.franrodr10.pitpat.session.TreadmillManager.Link
import io.github.franrodr10.pitpat.session.TreadmillManager.Message
import io.github.franrodr10.pitpat.session.TreadmillManager.State
import io.github.franrodr10.pitpat.ui.AppViewModel.Screen
import io.github.franrodr10.pitpat.ui.theme.PitPatColors
import io.github.franrodr10.pitpat.ui.theme.PitPatTheme
import kotlin.math.abs

/** What the control screen can ask for; defaults do nothing so previews need no view model. */
interface ControlActions {
    fun startOrPause() {}
    fun stop() {}
    fun changeSpeed(deltaKmh: Double) {}
    fun selectSpeed(kmh: Double) {}
    fun dismissAlert() {}
    fun connect() {}
    fun openDevices() {}
    fun openSettings() {}
}

private class ViewModelActions(private val vm: AppViewModel) : ControlActions {
    override fun startOrPause() = vm.manager.startOrPause()
    override fun stop() = vm.manager.stop()
    override fun changeSpeed(deltaKmh: Double) = vm.manager.changeSpeed(deltaKmh)
    override fun selectSpeed(kmh: Double) = vm.manager.selectSpeed(kmh)
    override fun dismissAlert() = vm.manager.dismissAlert()
    override fun connect() = vm.manager.reconnect()
    override fun openDevices() = vm.navigate(Screen.DEVICES)
    override fun openSettings() = vm.navigate(Screen.SETTINGS)
}

@Composable
fun ControlScreen(vm: AppViewModel, state: State) {
    val presets by vm.presets.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val texts = mapOf(
        Message.NOT_CONNECTED to stringResource(R.string.message_not_connected),
        Message.NO_DATA to stringResource(R.string.message_no_data),
        Message.RECONNECTED to stringResource(R.string.message_reconnected),
        Message.INCOMPATIBLE to stringResource(R.string.message_incompatible),
    )
    LaunchedEffect(vm) {
        vm.manager.messages.collect { snackbar.showSnackbar(texts.getValue(it)) }
    }
    ControlContent(state, presets, snackbar, remember(vm) { ViewModelActions(vm) })
}

@Composable
fun ControlContent(state: State, presets: List<Double>, snackbar: SnackbarHostState, actions: ControlActions) {
    Scaffold(
        topBar = { ConnectionBar(state, actions) },
        bottomBar = { BottomControls(state, actions) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.alert?.let { AlertBanner(it, onDismiss = actions::dismissAlert) }
            SpeedDisplay(state)
            Metrics(state)
            SpeedControls(state, presets, actions)
            Spacer(Modifier.height(4.dp))
        }
    }
}

@Composable
private fun ConnectionBar(state: State, actions: ControlActions) {
    val (text, color) = when (state.link) {
        Link.NO_DEVICE -> stringResource(R.string.link_no_device) to PitPatColors.Muted
        Link.DISCONNECTED -> stringResource(R.string.link_disconnected) to PitPatColors.Stop
        Link.CONNECTING -> stringResource(R.string.link_connecting) to PitPatColors.Pause
        Link.RECONNECTING -> stringResource(R.string.link_reconnecting, state.attempt) to PitPatColors.Pause
        Link.CONNECTED ->
            if (state.fresh) stringResource(R.string.link_connected) to PitPatColors.Go
            else stringResource(R.string.link_no_data) to PitPatColors.Pause
    }
    Row(
        modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(12.dp).background(color, CircleShape))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1)
            state.deviceName?.let { Text(it, color = PitPatColors.Muted, fontSize = 13.sp, maxLines = 1) }
        }
        when (state.link) {
            Link.NO_DEVICE -> TextButton(onClick = actions::openDevices) { Text(stringResource(R.string.action_choose)) }
            Link.DISCONNECTED -> TextButton(onClick = actions::connect) { Text(stringResource(R.string.action_connect)) }
            else -> Unit
        }
        TextButton(onClick = actions::openSettings) { Text(stringResource(R.string.action_settings)) }
    }
}

@Composable
private fun AlertBanner(alert: Alert, onDismiss: () -> Unit) {
    val text = stringResource(
        when (alert) {
            Alert.LINK_LOST -> R.string.alert_link_lost
            Alert.LINK_LOST_WHILE_MOVING -> R.string.alert_link_lost_moving
            Alert.STOP_NOT_CONFIRMED -> R.string.alert_stop_not_confirmed
        },
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(PitPatColors.AlertBackground, RoundedCornerShape(14.dp))
            .padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_dismiss)) }
    }
}

@Composable
private fun SpeedDisplay(state: State) {
    val status = state.status
    Column(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = status?.let { Format.speed(it.speedKmh) } ?: "–",
            fontSize = 96.sp,
            lineHeight = 96.sp,
            fontWeight = FontWeight.Bold,
            color = if (status != null && state.fresh) MaterialTheme.colorScheme.onBackground else PitPatColors.Muted,
        )
        Text(stringResource(R.string.unit_kmh), fontSize = 20.sp, color = PitPatColors.Muted)
        Spacer(Modifier.height(4.dp))
        Text(
            text = stateLabel(status) + " · " + stringResource(R.string.target_speed, Format.speed(state.targetKmh)),
            fontSize = 18.sp,
            color = PitPatColors.Muted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun stateLabel(status: TreadmillStatus?): String = stringResource(
    when (status?.state) {
        null -> R.string.state_unknown
        RunState.STOPPED -> R.string.state_stopped
        RunState.STARTING -> R.string.state_starting
        RunState.RUNNING -> R.string.state_running
        RunState.PAUSED -> R.string.state_paused
    },
)

@Composable
private fun Metrics(state: State) {
    val status = state.status
    val steps = state.steps
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric(status?.let { Format.duration(it.durationSeconds) }, stringResource(R.string.metric_time), Modifier.weight(1f))
            Metric(status?.let { Format.distance(it.distanceKm) }, stringResource(R.string.metric_distance), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric(
                value = steps?.let { (if (it.estimated) "≈" else "") + Format.count(it.count) },
                label = stringResource(if (steps?.estimated == true) R.string.metric_steps_estimated else R.string.metric_steps),
                modifier = Modifier.weight(1f),
            )
            Metric(status?.let { Format.count(it.kcal.toLong()) }, stringResource(R.string.metric_kcal), Modifier.weight(1f))
        }
    }
}

@Composable
private fun Metric(value: String?, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(PitPatColors.Surface, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(value ?: "–", fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(label, fontSize = 13.sp, color = PitPatColors.Muted, maxLines = 1)
    }
}

@Composable
private fun SpeedControls(state: State, presets: List<Double>, actions: ControlActions) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton(stringResource(R.string.action_slower), Modifier.weight(1f)) { actions.changeSpeed(-0.5) }
            BigButton(stringResource(R.string.action_faster), Modifier.weight(1f)) { actions.changeSpeed(0.5) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (preset in presets) {
                BigButton(
                    text = Format.preset(preset),
                    modifier = Modifier.weight(1f),
                    height = 64.dp,
                    selected = abs(preset - state.targetKmh) < 0.05,
                ) { actions.selectSpeed(preset) }
            }
        }
    }
}

@Composable
private fun BigButton(
    text: String,
    modifier: Modifier = Modifier,
    height: Dp = 72.dp,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = modifier.height(height),
        shape = RoundedCornerShape(16.dp),
        contentPadding = PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) PitPatColors.Accent else PitPatColors.SurfaceHigh,
            contentColor = if (selected) PitPatColors.OnAccent else PitPatColors.Text,
        ),
    ) {
        Text(text, fontSize = 26.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun MainButton(state: State, onClick: () -> Unit) {
    val runState = state.status?.state
    val connected = state.link == Link.CONNECTED && runState != null
    val (label, color) = when {
        !connected -> R.string.action_start to PitPatColors.Go
        runState == RunState.RUNNING -> R.string.action_pause to PitPatColors.Pause
        runState == RunState.STARTING -> R.string.action_starting to PitPatColors.Pause
        runState == RunState.PAUSED -> R.string.action_resume to PitPatColors.Go
        else -> R.string.action_start to PitPatColors.Go
    }
    val showsTarget = label == R.string.action_start || label == R.string.action_resume
    Button(
        onClick = onClick,
        enabled = connected && runState != RunState.STARTING,
        modifier = Modifier.fillMaxWidth().height(80.dp),
        shape = RoundedCornerShape(20.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = color,
            contentColor = Color.Black,
            disabledContainerColor = color.copy(alpha = 0.35f),
            disabledContentColor = Color.Black.copy(alpha = 0.6f),
        ),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(label), fontSize = 28.sp, fontWeight = FontWeight.Black)
            if (showsTarget) Text(stringResource(R.string.action_start_at, Format.speed(state.targetKmh)), fontSize = 16.sp)
        }
    }
}

/** START/PAUSE and STOP stay pinned at the bottom, reachable on any screen size. */
@Composable
private fun BottomControls(state: State, actions: ControlActions) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MainButton(state, onClick = actions::startOrPause)
        // Always enabled: without a link it warns and vibrates instead of doing nothing.
        Button(
            onClick = actions::stop,
            modifier = Modifier.fillMaxWidth().height(80.dp),
            shape = RoundedCornerShape(20.dp),
            colors = ButtonDefaults.buttonColors(containerColor = PitPatColors.Stop, contentColor = Color.White),
        ) {
            Text(stringResource(R.string.action_stop), fontSize = 32.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Preview(widthDp = 400, heightDp = 880)
@Composable
private fun ControlPreview() {
    PitPatTheme {
        ControlContent(
            state = State(
                link = Link.CONNECTED,
                deviceName = "PitPat-T01",
                bluetoothOn = true,
                status = TreadmillStatus(RunState.RUNNING, 3.5, 3.5, 1.24, 1_234, 0, 56, 6.0),
                fresh = true,
                steps = StepEstimator.Steps(1_610, estimated = true),
                targetKmh = 3.5,
                speedRange = 1.0..6.0,
            ),
            presets = listOf(3.0, 4.0, 5.0, 6.0),
            snackbar = remember { SnackbarHostState() },
            actions = object : ControlActions {},
        )
    }
}
