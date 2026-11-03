package br.net.anamnesia

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import java.io.File

/**
 * O Anamnesia é o site anamnesia.net.br aberto num WebView. O app existe para ter o widget
 * do checklist na tela inicial: o site envia ao app só leito, iniciais e contagens (window.AnamnesiaApp).
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var pageReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this)
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString AnamnesiaApp/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "AnamnesiaApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "https" && u.host == HOST) return false
                // e-mail, Gmail e qualquer outro endereço abrem fora do app
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Nenhum app para abrir este link", Toast.LENGTH_SHORT).show()
                }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) { pageReady = true }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                pickFile.launch("*/*")
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.anamnesiaBack ? anamnesiaBack() : false)") { r ->
                    if (r != "true") moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(startUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val pt = ptOf(intent) ?: return
        if (pageReady) web.evaluateJavascript("window.anamnesiaOpen && anamnesiaOpen('ck', '$pt')", null)
        else web.loadUrl(startUrl(intent))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun ptOf(i: Intent?): String? {
        if (i?.getBooleanExtra(EXTRA_CK, false) != true) return null
        // só letras e números (os ids dos pacientes são assim); evita injetar texto no JavaScript
        return (i.getStringExtra(EXTRA_PT) ?: "").filter { it.isLetterOrDigit() }
    }

    private fun startUrl(i: Intent?): String {
        val pt = ptOf(i) ?: return BASE
        return "$BASE?abrir=ck&pt=$pt"
    }

    /** Métodos que o site chama (window.AnamnesiaApp.*). Só o domínio do Anamnesia carrega no app. */
    inner class Bridge {
        @JavascriptInterface
        fun updateWidget(json: String) {
            WidgetData.save(this@MainActivity, json)
            ChecklistWidget.updateAll(this@MainActivity)
        }

        @JavascriptInterface
        fun copy(text: String) {
            runOnUiThread {
                val cm = getSystemService(ClipboardManager::class.java)
                cm.setPrimaryClip(ClipData.newPlainText("Anamnesia", text))
            }
        }

        @JavascriptInterface
        fun saveFile(name: String, content: String, mime: String) {
            val safe = name.replace(Regex("[^\\w.-]+"), "_")
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safe)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                        ?: throw IllegalStateException()
                    contentResolver.openOutputStream(uri)!!.use { it.write(content.toByteArray()) }
                } else {
                    @Suppress("DEPRECATION")
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    File(dir, safe).writeText(content)
                }
                runOnUiThread { Toast.makeText(this@MainActivity, "Salvo em Downloads: $safe", Toast.LENGTH_LONG).show() }
            } catch (_: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Não foi possível salvar o arquivo", Toast.LENGTH_LONG).show() }
            }
        }

        @JavascriptInterface
        fun print() {
            runOnUiThread {
                val pm = getSystemService(PrintManager::class.java)
                val adapter = web.createPrintDocumentAdapter("Anamnesia")
                pm.print("Anamnesia", PrintAdapterWrapper(adapter) {
                    web.evaluateJavascript("window.dispatchEvent(new Event('afterprint'))", null)
                }, PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
            }
        }
    }

    companion object {
        const val HOST = "anamnesia.net.br"
        const val BASE = "https://anamnesia.net.br/"
        const val EXTRA_CK = "abrir_ck"
        const val EXTRA_PT = "pt"
    }
}
