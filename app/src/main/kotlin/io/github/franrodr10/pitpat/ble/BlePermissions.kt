package io.github.franrodr10.pitpat.ble

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

object BlePermissions {
    /** Runtime permissions needed to scan for and connect to the treadmill on this Android version. */
    val required: Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
        }

    val usesLocation: Boolean get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.S

    fun granted(context: Context): Boolean =
        required.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** Before Android 12, scans only return results while location services are on. */
    fun scanNeedsLocation(context: Context): Boolean {
        if (!usesLocation) return false
        val locationManager = context.getSystemService(LocationManager::class.java) ?: return false
        return !LocationManagerCompat.isLocationEnabled(locationManager)
    }
}
