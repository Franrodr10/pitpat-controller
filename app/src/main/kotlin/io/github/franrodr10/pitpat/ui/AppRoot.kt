package io.github.franrodr10.pitpat.ui

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.franrodr10.pitpat.R
import io.github.franrodr10.pitpat.ble.BlePermissions
import io.github.franrodr10.pitpat.session.TreadmillManager.Link
import io.github.franrodr10.pitpat.ui.AppViewModel.Screen
import io.github.franrodr10.pitpat.ui.theme.PitPatColors

@Composable
fun AppRoot(vm: AppViewModel) {
    val granted by vm.permissionsGranted.collectAsStateWithLifecycle()
    val state by vm.manager.state.collectAsStateWithLifecycle()
    val screen by vm.screen.collectAsStateWithLifecycle()

    // Keep the screen on for the whole session, whatever screen is showing.
    KeepScreenOn(granted && state.isActive)

    Surface(color = MaterialTheme.colorScheme.background) {
        when {
            !granted -> PermissionScreen(onResult = vm::onForeground)
            !state.bluetoothOn -> BluetoothOffScreen()
            else -> when (screen) {
                Screen.CONTROL -> ControlScreen(vm, state)
                Screen.DEVICES -> DevicesScreen(vm, canGoBack = state.link != Link.NO_DEVICE)
                Screen.SETTINGS -> SettingsScreen(vm, state)
                Screen.LOG -> LogScreen(vm)
            }
        }
    }
}

@Composable
private fun KeepScreenOn(enabled: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, enabled) {
        view.keepScreenOn = enabled
        onDispose { view.keepScreenOn = false }
    }
}

@Composable
private fun PermissionScreen(onResult: () -> Unit) {
    val activity = LocalActivity.current
    val context = LocalContext.current
    var denied by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        denied = results.values.any { granted -> !granted }
        onResult()
    }
    // Once Android stops showing the dialog, the only way left is the app settings.
    val blocked = denied && activity != null &&
        BlePermissions.required.none { activity.shouldShowRequestPermissionRationale(it) }
    val explanation = stringResource(if (BlePermissions.usesLocation) R.string.permission_text_legacy else R.string.permission_text)
    CenteredMessage(
        title = stringResource(R.string.permission_title),
        text = if (blocked) explanation + "\n\n" + stringResource(R.string.permission_denied) else explanation,
        action = stringResource(if (blocked) R.string.permission_open_settings else R.string.permission_grant),
        onAction = { if (blocked) openAppSettings(context) else launcher.launch(BlePermissions.required) },
    )
}

@SuppressLint("MissingPermission") // shown only once the Bluetooth permission is granted
@Composable
private fun BluetoothOffScreen() {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {}
    CenteredMessage(
        title = stringResource(R.string.bluetooth_off_title),
        text = stringResource(R.string.bluetooth_off_text),
        action = stringResource(R.string.bluetooth_enable),
        onAction = { runCatching { launcher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)) } },
    )
}

@Composable
private fun CenteredMessage(title: String, text: String, action: String, onAction: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().systemBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Text(text, fontSize = 17.sp, color = PitPatColors.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onAction, modifier = Modifier.fillMaxWidth().height(64.dp), shape = RoundedCornerShape(16.dp)) {
            Text(action, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Title row for the secondary screens, with an optional way back. */
@Composable
fun SimpleTopBar(title: String, onBack: (() -> Unit)?) {
    Row(
        modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), fontSize = 17.sp) }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
    )
}
