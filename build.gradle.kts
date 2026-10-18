plugins {
    alias(libs.plugins.android.application) apply false
    // Declaring the Kotlin plugin here also pins the Kotlin version used by AGP's built-in Kotlin.
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
