plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.piweb.twa"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.piweb.twa"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // Launch origin, baked in as a resource at build time. Sourced from
        // the PIWEB_TWA_LAUNCH_URL gradle property (see gradle.properties);
        // overriding it via -PPIWEB_TWA_LAUNCH_URL=... requires no code edit.
        resValue(
            "string",
            "twa_launch_url",
            providers.gradleProperty("PIWEB_TWA_LAUNCH_URL")
                .getOrElse("https://gcp-dev.stevenforai.top"),
        )
    }

    signingConfigs {
        create("release") {
            // Side-loaded private-repo app (plan decision Q2): the release
            // keystore is committed under keystore/ — see keystore/README.md
            // for the per-machine regeneration story. The scripts regenerate
            // assetlinks.json from whatever certificate actually signed the
            // APK, so a regenerated keystore can never ship silently
            // mismatched (scripts/assetlinks.sh).
            storeFile = rootProject.file("keystore/piweb-twa-release.keystore")
            storePassword = "piweb-twa-release"
            keyAlias = "piweb-twa"
            keyPassword = "piweb-twa-release"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Trusted Web Activity host: androidx.browser Custom Tabs. This is the
    // ONLY dependency — the shell contains no WebView code of its own, no
    // proxying, and no script injection (pi#40).
    implementation("androidx.browser:browser:1.8.0")
}
