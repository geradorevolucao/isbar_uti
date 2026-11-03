plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.net.anamnesia"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.net.anamnesia"
        minSdk = 26
        targetSdk = 34
        // versionCode cresce a cada build do GitHub (número da execução), para o Android aceitar a atualização
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // Assinatura: a chave NUNCA fica no repositório. Se os segredos ANAMNESIA_KEYSTORE_B64 e
    // ANAMNESIA_KS_PASS existirem no GitHub, o workflow grava a chave em app/release.keystore e todas
    // as versões saem com a mesma assinatura (cada uma instala por cima da anterior). Sem eles, o
    // build usa a chave de depuração da máquina do GitHub, que muda a cada execução.
    val ks = file("release.keystore")
    signingConfigs {
        if (ks.exists()) create("anamnesia") {
            storeFile = ks
            storePassword = System.getenv("ANAMNESIA_KS_PASS")
            keyAlias = "anamnesia"
            keyPassword = System.getenv("ANAMNESIA_KS_PASS")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks.exists()) signingConfigs.getByName("anamnesia") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-remoteviews:1.1.0")
}
