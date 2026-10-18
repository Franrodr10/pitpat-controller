package io.github.franrodr10.pitpat.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormatTest {
    @Test
    fun `speeds use a decimal comma`() {
        assertEquals("3,5", Format.speed(3.5))
        assertEquals("6,0", Format.speed(6.0))
    }

    @Test
    fun `presets drop a useless decimal`() {
        assertEquals("4", Format.preset(4.0))
        assertEquals("3,5", Format.preset(3.5))
    }

    @Test
    fun `durations show hours only when needed`() {
        assertEquals("12:34", Format.duration(754))
        assertEquals("1:02:03", Format.duration(3_723))
    }

    @Test
    fun `parses speeds typed with comma or dot`() {
        assertEquals(4.5, Format.parseSpeed(" 4,5 ")!!, 0.0)
        assertEquals(3.0, Format.parseSpeed("3")!!, 0.0)
        assertNull(Format.parseSpeed("rápido"))
    }
}
