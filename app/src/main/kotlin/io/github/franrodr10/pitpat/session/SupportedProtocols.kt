package io.github.franrodr10.pitpat.session

import io.github.franrodr10.pitpat.core.protocol.PitPatProtocol
import io.github.franrodr10.pitpat.core.protocol.TreadmillProtocol

/** Every treadmill protocol the app speaks. To support another treadmill, add its implementation here. */
object SupportedProtocols {
    val all: List<TreadmillProtocol> = listOf(PitPatProtocol)

    fun byName(name: String?): TreadmillProtocol = all.firstOrNull { it.name == name } ?: all.first()
}
