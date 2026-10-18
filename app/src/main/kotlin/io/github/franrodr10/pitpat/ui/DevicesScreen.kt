package io.github.franrodr10.pitpat.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.franrodr10.pitpat.R
import io.github.franrodr10.pitpat.ble.BlePermissions
import io.github.franrodr10.pitpat.ble.BleScanner
import io.github.franrodr10.pitpat.ui.AppViewModel.Screen
import io.github.franrodr10.pitpat.ui.theme.PitPatColors

@Composable
fun DevicesScreen(vm: AppViewModel, canGoBack: Boolean) {
    val results by vm.scanner.results.collectAsStateWithLifecycle()
    val scanning by vm.scanner.scanning.collectAsStateWithLifecycle()
    val error by vm.scanner.error.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val goBack = { vm.navigate(Screen.CONTROL) }
    BackHandler(enabled = canGoBack, onBack = goBack)

    Scaffold(topBar = { SimpleTopBar(stringResource(R.string.devices_title), if (canGoBack) goBack else null) }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (BlePermissions.scanNeedsLocation(context)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.devices_location_off), color = PitPatColors.Pause)
                        OutlinedButton(onClick = { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }) {
                            Text(stringResource(R.string.devices_open_location))
                        }
                    }
                }
            }
            items(results, key = { it.address }) { device -> DeviceRow(device) { vm.choose(device) } }
            item {
                if (scanning) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(R.string.devices_scanning), color = PitPatColors.Muted)
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        error?.let { Text(stringResource(R.string.devices_scan_failed, it), color = PitPatColors.Stop) }
                        if (results.isEmpty()) Text(stringResource(R.string.devices_none), color = PitPatColors.Muted)
                        OutlinedButton(onClick = { vm.scanner.start() }) { Text(stringResource(R.string.devices_scan_again)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeviceRow(device: BleScanner.Found, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(76.dp),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = PitPatColors.SurfaceHigh, contentColor = PitPatColors.Text),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Text(device.name ?: device.protocol.name, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            // Only the end of the address, enough to tell two treadmills apart.
            Text(
                stringResource(R.string.devices_details, "…" + device.address.takeLast(5), device.rssi),
                fontSize = 14.sp,
                color = PitPatColors.Muted,
            )
        }
    }
}
