import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing comes from environment variables (GitHub Secrets in CI) or from local.properties,
// never from the repository. Without them, release builds use the debug key so they still install.
val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}

fun signingValue(name: String): String? =
    providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() } ?: localProperties.getProperty(name)

val releaseKeystore: String? = signingValue("SIGNING_STORE_FILE")

android {
    namespace = "io.github.franrodr10.pitpat"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.franrodr10.pitpat"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.1.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                val password = signingValue("SIGNING_STORE_PASSWORD")
                storeFile = file(releaseKeystore)
                storePassword = password
                keyAlias = signingValue("SIGNING_KEY_ALIAS") ?: "pitpat"
                keyPassword = signingValue("SIGNING_KEY_PASSWORD") ?: password
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
}
