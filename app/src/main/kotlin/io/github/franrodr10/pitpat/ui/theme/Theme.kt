package io.github.franrodr10.pitpat.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object PitPatColors {
    val Background = Color(0xFF0E1116)
    val Surface = Color(0xFF171C24)
    val SurfaceHigh = Color(0xFF232A35)
    val Text = Color(0xFFE8EAED)
    val Muted = Color(0xFF9AA0A6)
    val Accent = Color(0xFF8AB4F8)
    val OnAccent = Color(0xFF0B1A33)
    val Go = Color(0xFF34A853)
    val Pause = Color(0xFFF9AB00)
    val Stop = Color(0xFFD93025)
    val AlertBackground = Color(0xFF5C1E1A)
}

private val colors = darkColorScheme(
    primary = PitPatColors.Accent,
    onPrimary = PitPatColors.OnAccent,
    background = PitPatColors.Background,
    onBackground = PitPatColors.Text,
    surface = PitPatColors.Background,
    onSurface = PitPatColors.Text,
    surfaceVariant = PitPatColors.Surface,
    onSurfaceVariant = PitPatColors.Muted,
    surfaceContainer = PitPatColors.Surface,
    surfaceContainerHigh = PitPatColors.SurfaceHigh,
    surfaceContainerHighest = PitPatColors.SurfaceHigh,
    error = Color(0xFFF28B82),
)

/** The app is always dark: easier on the eyes and on the battery while walking. */
@Composable
fun PitPatTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
