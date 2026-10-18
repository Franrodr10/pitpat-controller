package io.github.franrodr10.pitpat

import android.app.Application
import io.github.franrodr10.pitpat.session.DiagnosticsLog
import io.github.franrodr10.pitpat.session.Haptics
import io.github.franrodr10.pitpat.session.Settings
import io.github.franrodr10.pitpat.session.TreadmillManager

class PitPatApp : Application() {
    val settings: Settings by lazy { Settings(this) }

    /** App-wide so the link survives screen rotations and navigation. */
    val manager: TreadmillManager by lazy {
        TreadmillManager(this, settings, DiagnosticsLog(), Haptics(this), BuildConfig.VERSION_NAME)
    }
}
