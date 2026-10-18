package io.github.franrodr10.pitpat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.franrodr10.pitpat.BuildConfig
import io.github.franrodr10.pitpat.R
import io.github.franrodr10.pitpat.session.TreadmillManager
import io.github.franrodr10.pitpat.ui.AppViewModel.Screen
import io.github.franrodr10.pitpat.ui.theme.PitPatColors

@Composable
fun SettingsScreen(vm: AppViewModel, state: TreadmillManager.State) {
    val presets by vm.presets.collectAsStateWithLifecycle()
    val keepAlive by vm.keepAlive.collectAsStateWithLifecycle()
    var fields by remember(presets) { mutableStateOf(presets.map(Format::preset)) }
    val range = state.speedRange
    val parsed = fields.map { text -> Format.parseSpeed(text)?.takeIf { it in range } }
    val goBack = { vm.navigate(Screen.CONTROL) }
    BackHandler(onBack = goBack)

    Scaffold(topBar = { SimpleTopBar(stringResource(R.string.settings_title), goBack) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(stringResource(R.string.settings_presets), fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                fields.forEachIndexed { index, text ->
                    OutlinedTextField(
                        value = text,
                        onValueChange = { new -> fields = fields.toMutableList().also { it[index] = new } },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        isError = parsed[index] == null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        textStyle = LocalTextStyle.current.copy(fontSize = 20.sp, textAlign = TextAlign.Center),
                    )
                }
            }
            Text(
                stringResource(R.string.settings_presets_range, Format.speed(range.start), Format.speed(range.endInclusive)),
                color = PitPatColors.Muted,
                fontSize = 14.sp,
            )
            Button(
                onClick = { vm.savePresets(parsed.filterNotNull()) },
                enabled = parsed.all { it != null } && parsed != presets,
            ) {
                Text(stringResource(R.string.settings_save))
            }

            HorizontalDivider()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(stringResource(R.string.settings_keep_alive), fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                    Text(stringResource(R.string.settings_keep_alive_text), color = PitPatColors.Muted, fontSize = 14.sp)
                }
                Switch(checked = keepAlive, onCheckedChange = vm::setKeepAlive)
            }

            HorizontalDivider()
            Text(stringResource(R.string.settings_device), fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Text(state.deviceName ?: stringResource(R.string.settings_no_device))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.navigate(Screen.DEVICES) }) { Text(stringResource(R.string.settings_change_device)) }
                if (state.link != TreadmillManager.Link.NO_DEVICE) {
                    OutlinedButton(onClick = vm::forgetDevice) { Text(stringResource(R.string.settings_forget_device)) }
                }
            }

            HorizontalDivider()
            OutlinedButton(onClick = { vm.navigate(Screen.LOG) }) { Text(stringResource(R.string.settings_log)) }
            Text(stringResource(R.string.settings_about, BuildConfig.VERSION_NAME), color = PitPatColors.Muted, fontSize = 13.sp)
        }
    }
}
