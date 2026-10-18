package io.github.franrodr10.pitpat.ui

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.franrodr10.pitpat.R
import io.github.franrodr10.pitpat.ui.AppViewModel.Screen
import io.github.franrodr10.pitpat.ui.theme.PitPatColors

/** Android rejects intents bigger than about 1 MB, so only the end of a long log is shared. */
private const val MAX_SHARED_CHARS = 400_000

@Composable
fun LogScreen(vm: AppViewModel) {
    val revision by vm.log.revision.collectAsStateWithLifecycle()
    val lines = remember(revision) { vm.log.snapshot() }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val subject = stringResource(R.string.log_subject)
    val goBack = { vm.navigate(Screen.SETTINGS) }
    BackHandler(onBack = goBack)
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.scrollToItem(lines.lastIndex)
    }

    Scaffold(topBar = { SimpleTopBar(stringResource(R.string.log_title), goBack) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp)) {
            Text(stringResource(R.string.log_privacy), color = PitPatColors.Muted, fontSize = 13.sp)
            Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { share(context, subject, lines) }) { Text(stringResource(R.string.log_share)) }
                OutlinedButton(onClick = { vm.log.clear() }) { Text(stringResource(R.string.log_clear)) }
            }
            LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth().navigationBarsPadding()) {
                items(lines) { line ->
                    Text(line, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 14.sp)
                }
            }
        }
    }
}

private fun share(context: Context, subject: String, lines: List<String>) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, subject)
        .putExtra(Intent.EXTRA_TEXT, lines.joinToString("\n").takeLast(MAX_SHARED_CHARS))
    context.startActivity(Intent.createChooser(send, null))
}
