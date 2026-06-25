package com.velosia.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import com.google.android.material.snackbar.Snackbar
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var fabClose: ExtendedFloatingActionButton

    private val RC_SIGN_IN = 9001
    private val RC_FILE_CHOOSER = 9002
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    // Server addresses (default to production for physical devices)
    private var frontendUrl = "https://velosia.henrikheil.net"
    private var backendUrl = "https://api.velosia.henrikheil.net"

    private var activeDraftJson: String? = null
    private var activePlatform: String? = null
    // All draft photos, fetched server-side (okhttp, no browser CORS) and base64
    // data-URL encoded, handed to the autofill engine via the JS bridge so it can
    // inject every photo without a file chooser or a cross-origin fetch.
    @Volatile private var draftImageDataUrls: List<String> = emptyList()
    private var userZip: String? = null
    // Guards the automatic one-shot fill so it does not re-trigger on every SPA page event
    private var hasAutoFilled = false
    // Guards the automatic category pre-selection on the Kleinanzeigen step 1 page
    private var hasAutoCategory = false
    // Whether the user enabled "publish automatically" in their profile settings.
    // Default off so the user reviews the prefilled listing and publishes himself.
    private var autoSubmitSetting = false
    // Cached autofill engine JS (the very same file the browser extension uses,
    // bundled here as an asset). Read once, then reused for every injection.
    private var engineJsCache: String? = null
    // Latest engine fetched over the web (frontend /autofill-engine.js). Preferred
    // over the bundled asset when present, so engine tweaks ship via a quick web
    // deploy without a full Play release. Refreshed on each "post to platform".
    @Volatile private var remoteEngineJs: String? = null

    private val okHttpClient = OkHttpClient()

    // Google Play In-App Updates. Replaces the former self-download/-install OTA
    // mechanism: when distributed via Play, Play itself performs the download and
    // install — we only detect availability and prompt the user (flexible flow).
    private lateinit var appUpdateManager: AppUpdateManager
    private val RC_APP_UPDATE = 9003
    private val installStateListener = InstallStateUpdatedListener { state ->
        if (state.installStatus() == InstallStatus.DOWNLOADED) {
            showUpdateDownloadedPrompt()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Request runtime camera permission
        checkCameraPermission()

        // Detect if running in emulator and override URLs
        if (isEmulator()) {
            frontendUrl = "http://10.0.2.2:5173"
            backendUrl = "http://10.0.2.2:8000"
            Toast.makeText(this, "Emulator erkannt - Lade lokale Server", Toast.LENGTH_SHORT).show()
        }

        webView = findViewById(R.id.webView)
        fabClose = findViewById(R.id.fabClose)

        // Enable remote inspection of the WebView (chrome://inspect) and route the
        // engine's console logs to Logcat. Invaluable for diagnosing autofill on the
        // live Play build during the internal-test phase.
        // TODO: gate behind BuildConfig.DEBUG (or remove) before the public production release.
        WebView.setWebContentsDebuggingEnabled(true)

        // Configure WebView settings
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.databaseEnabled = true
        
        // Use a standard mobile Chrome user agent to prevent Cloudflare/Vinted bot-blocking
        settings.userAgentString = "Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"

        // Register JS interface
        webView.addJavascriptInterface(VelosiaBridge(), "VelosiaBridge")

        // Setup WebViewClient
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep navigation within the WebView
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)

                // Allow the user to bail out of any external listing page at any time
                val isDashboard = url.startsWith(frontendUrl)
                fabClose.visibility = if (isDashboard) View.GONE else View.VISIBLE

                val isVintedForm = url.contains("vinted.de/items/new") ||
                    url.contains("vinted.fr/items/new")
                // Kleinanzeigen step 1 is only the category picker; the real form lives on
                // p-anzeige-aufgeben-schritt2.html, so we treat that as the fillable page.
                val isKleinanzeigenCategory = url.contains("kleinanzeigen.de/p-anzeige-aufgeben.html")
                val isKleinanzeigenForm = url.contains("kleinanzeigen.de/p-anzeige-aufgeben-schritt2")
                val isFormPage = isVintedForm || isKleinanzeigenForm

                if (activeDraftJson != null && (isFormPage || isKleinanzeigenCategory)) {
                    // On the actual form, fill once it has loaded. Whether it ALSO
                    // submits depends on the user's "publish automatically" setting
                    // (default off -> the user reviews and clicks publish himself).
                    if (isFormPage && !hasAutoFilled) {
                        hasAutoFilled = true
                        // The forms render dynamically; give them a brief moment before
                        // injecting (the engine then polls for the fields itself).
                        webView.postDelayed({ injectAutofill(autoSubmit = autoSubmitSetting) }, 600)
                    }
                    // On the category picker, let the engine pre-select the category via
                    // the keyword suggestion field so the user reaches the form hands-free.
                    if (isKleinanzeigenCategory && !hasAutoCategory) {
                        hasAutoCategory = true
                        webView.postDelayed({ injectAutofill(autoSubmit = false) }, 600)
                    }
                }
            }
        }

        // Setup WebChromeClient to handle manual image picks & camera permission.
        // Note: the draft photos are uploaded automatically by the autofill engine
        // itself (it fetches them from the backend and injects all of them via a
        // DataTransfer — no file chooser, no user gesture). This chooser therefore
        // only handles the user manually adding *extra* photos.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                // Open standard system file picker to select images
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                
                try {
                    val intent = fileChooserParams.createIntent()
                    startActivityForResult(intent, RC_FILE_CHOOSER)
                } catch (e: Exception) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    Toast.makeText(this@MainActivity, "Galerie konnte nicht geöffnet werden.", Toast.LENGTH_SHORT).show()
                    return false
                }
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    // Grant WebRTC camera permission dynamically
                    request.grant(request.resources)
                }
            }

            // Forward WebView console output to Logcat so the engine's autofill logs
            // ("Velosia …") are visible via `adb logcat -s VelosiaWeb` even without
            // chrome://inspect.
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("VelosiaWeb", "${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                return true
            }

            override fun getDefaultVideoPoster(): android.graphics.Bitmap? {
                return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
            }
        }

        // Close button: leave the external listing page and return to the dashboard
        fabClose.setOnClickListener {
            closeListingView()
        }

        // Load the frontend dashboard
        webView.loadUrl(frontendUrl)

        // Ask Play whether a newer version is live (no-op on non-Play installs).
        appUpdateManager = AppUpdateManagerFactory.create(this)
        appUpdateManager.registerListener(installStateListener)
        checkForUpdates()
    }

    // Javascript Interface definition
    inner class VelosiaBridge {
        @JavascriptInterface
        fun postToPlatform(draftId: Int, platform: String, token: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, "Lade Angebot #$draftId...", Toast.LENGTH_SHORT).show()
                hasAutoFilled = false
                hasAutoCategory = false
                draftImageDataUrls = emptyList()
                prefetchRemoteEngine()
                fetchUserProfile(token)
                fetchDraftAndPrepare(draftId, platform, token)
            }
        }

        @JavascriptInterface
        fun loginWithGoogle(clientId: String) {
            runOnUiThread {
                startGoogleSignIn(clientId)
            }
        }

        // The autofill engine pulls the prepared draft photos (data: URLs) from here
        // and injects all of them — no file chooser, no cross-origin fetch.
        @JavascriptInterface
        fun getDraftImageCount(): Int = draftImageDataUrls.size

        @JavascriptInterface
        fun getDraftImageDataUrl(index: Int): String =
            draftImageDataUrls.getOrNull(index) ?: ""
    }

    // Fetch draft metadata from the backend, then navigate to the platform form.
    // The photos themselves are NOT pre-downloaded here: the autofill engine fetches
    // them directly from the backend (CORS is open) and injects all of them, so we
    // only need the draft JSON (which carries image_paths) in hand before navigating.
    private fun fetchDraftAndPrepare(draftId: Int, platform: String, token: String) {
        val request = Request.Builder()
            .url("$backendUrl/api/drafts/$draftId")
            .header("Authorization", "Bearer $token")
            .build()

        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Serververbindung fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) {
                        runOnUiThread {
                            Toast.makeText(this@MainActivity, "Fehler beim Laden des Angebots.", Toast.LENGTH_LONG).show()
                        }
                        return
                    }

                    val bodyString = response.body?.string() ?: return
                    activeDraftJson = bodyString
                    activePlatform = platform

                    prepareImagesAndNavigate(bodyString, platform)
                }
            }
        })
    }

    // Extract the draft's photo paths: image_paths (a JSON array, possibly stored as
    // a Python list repr with single quotes) with image_path as the single fallback.
    private fun extractImagePaths(draftJson: String): List<String> {
        return try {
            val o = JSONObject(draftJson)
            val out = mutableListOf<String>()
            val ip = o.optString("image_paths")
            if (ip.isNotEmpty() && ip != "null") {
                val arr = try { JSONArray(ip) } catch (e: Exception) { JSONArray(ip.replace("'", "\"")) }
                for (i in 0 until arr.length()) {
                    val s = arr.optString(i)
                    if (s.isNotEmpty()) out.add(s)
                }
            }
            if (out.isEmpty()) {
                val single = o.optString("image_path")
                if (single.isNotEmpty() && single != "null") out.add(single)
            }
            out
        } catch (e: Exception) {
            emptyList()
        }
    }

    // Download every draft photo with okhttp (server-side: no browser CORS), base64
    // data-URL encode them for the JS bridge, then navigate. Navigation happens once
    // all downloads have settled so the photos are ready when the engine asks.
    private fun prepareImagesAndNavigate(draftJson: String, platform: String) {
        draftImageDataUrls = emptyList()
        val paths = extractImagePaths(draftJson)
        if (paths.isEmpty()) {
            runOnUiThread { navigateToPlatformListing(platform) }
            return
        }
        val results = arrayOfNulls<String>(paths.size)
        val remaining = AtomicInteger(paths.size)
        for ((idx, p) in paths.withIndex()) {
            val url = if (p.startsWith("http")) p else "$backendUrl$p"
            okHttpClient.newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (remaining.decrementAndGet() == 0) finishImagePrep(results, platform)
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            if (response.isSuccessful) {
                                val bytes = response.body?.bytes()
                                if (bytes != null && bytes.isNotEmpty()) {
                                    val type = response.header("Content-Type") ?: "image/jpeg"
                                    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                                    results[idx] = "data:$type;base64,$b64"
                                }
                            }
                        } catch (e: Exception) {
                            // skip this image
                        } finally {
                            if (remaining.decrementAndGet() == 0) finishImagePrep(results, platform)
                        }
                    }
                }
            })
        }
    }

    private fun finishImagePrep(results: Array<String?>, platform: String) {
        draftImageDataUrls = results.filterNotNull()
        runOnUiThread { navigateToPlatformListing(platform) }
    }

    private fun navigateToPlatformListing(platform: String) {
        hasAutoFilled = false
        hasAutoCategory = false
        val url = if (platform == "vinted") {
            "https://www.vinted.de/items/new"
        } else {
            // Kleinanzeigen requires picking a category first; the form on
            // p-anzeige-aufgeben-schritt2.html is then auto-filled once it loads.
            "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html"
        }
        webView.loadUrl(url)
    }

    // Fetch the user's saved profile so we can prefill the postcode (required for
    // Kleinanzeigen submission). Best-effort: failures are silently ignored.
    private fun fetchUserProfile(token: String) {
        val request = Request.Builder()
            .url("$backendUrl/api/auth/me")
            .header("Authorization", "Bearer $token")
            .build()

        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // Ignore - postcode prefill is optional
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) return
                    val bodyString = response.body?.string() ?: return
                    try {
                        val json = JSONObject(bodyString)
                        val zip = json.optString("default_zip")
                        userZip = if (zip.isNullOrEmpty() || zip == "null") null else zip
                        autoSubmitSetting = json.optBoolean("auto_submit", false)
                    } catch (e: Exception) {
                        // Ignore malformed profile responses
                    }
                }
            }
        })
    }

    // Close the external listing page: drop the active draft session and return
    // to the Velosia dashboard.
    private fun closeListingView() {
        activeDraftJson = null
        activePlatform = null
        draftImageDataUrls = emptyList()
        hasAutoFilled = false
        hasAutoCategory = false
        fabClose.visibility = View.GONE
        webView.loadUrl(frontendUrl)
    }

    // Fetch the latest engine from the web (frontend /autofill-engine.js) so engine
    // tweaks can ship via a quick web deploy without a full Play release. Best-effort:
    // on any failure we just keep using the bundled asset. A cache-buster avoids stale
    // CDN copies. Kicked off when the user starts a "post to platform" so it is ready
    // by the time the form loads; if not, readEngineJs falls back to the asset.
    private fun prefetchRemoteEngine() {
        val url = "$frontendUrl/autofill-engine.js?ts=${System.currentTimeMillis()}"
        val request = Request.Builder().url(url).header("Cache-Control", "no-cache").build()
        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { /* keep bundled asset */ }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) return
                    val js = response.body?.string() ?: return
                    // Sanity check it is really the engine before trusting it.
                    if (js.contains("__velosia") && js.length > 1000) remoteEngineJs = js
                }
            }
        })
    }

    // Reads the shared autofill engine JS. Prefers the web-fetched copy (latest),
    // else the bundled asset (offline fallback), cached after the first read.
    private fun readEngineJs(): String {
        remoteEngineJs?.let { return it }
        engineJsCache?.let { return it }
        return try {
            val js = assets.open("autofill-engine.js").bufferedReader().use { it.readText() }
            engineJsCache = js
            js
        } catch (e: Exception) {
            ""
        }
    }

    // Injects the shared engine and runs the autofill. The engine itself detects
    // the platform and the phase (Kleinanzeigen category picker vs. the real form),
    // fills the fields with a React/Vue-safe native value setter, fetches and injects
    // all draft photos from the backend (imageMode 'datatransfer' + backendUrl), shows
    // the progress/result overlay and — only when autoSubmit is true — publishes the
    // listing automatically.
    private fun injectAutofill(autoSubmit: Boolean) {
        val draftJson = activeDraftJson ?: return
        val escapedJson = draftJson.replace("\\", "\\\\").replace("'", "\\'")
        val zip = userZip?.replace("\\", "\\\\")?.replace("'", "\\'") ?: ""
        val engine = readEngineJs()
        if (engine.isEmpty()) {
            Toast.makeText(this, "Autofill-Engine konnte nicht geladen werden.", Toast.LENGTH_SHORT).show()
            return
        }

        // The engine is injected as a raw string (it must NOT pass through Kotlin
        // string interpolation, or a literal '$' in the JS would corrupt it / break
        // the build). Only the tiny caller below — which carries the draft, zip and
        // autoSubmit flag — uses interpolation. The caller runs in the engine's
        // completion callback so window.__velosia is guaranteed to exist.
        val caller = """
            (function() {
                try {
                    var draft = JSON.parse('$escapedJson');
                    window.__velosia.autofill(draft, {
                        userZip: '$zip',
                        autoSubmit: $autoSubmit,
                        imageMode: 'bridge',
                        backendUrl: '$backendUrl',
                        showOverlay: true
                    });
                } catch (e) { console.error('Velosia autofill failed', e); }
            })();
        """.trimIndent()

        webView.evaluateJavascript(engine) {
            webView.evaluateJavascript(caller, null)
        }
    }

    private fun checkCameraPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 101)
        }
    }

    private fun isEmulator(): Boolean {
        val model = Build.MODEL
        val hardware = Build.HARDWARE
        val brand = Build.BRAND
        val device = Build.DEVICE
        val product = Build.PRODUCT
        val manufacturer = Build.MANUFACTURER
        return (brand.startsWith("generic") && device.startsWith("generic"))
                || Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || hardware.contains("goldfish")
                || hardware.contains("ranchu")
                || model.contains("google_sdk")
                || model.contains("Emulator")
                || model.contains("Android SDK built for x86")
                || manufacturer.contains("Genymotion")
                || product.indexOf("sdk_google") != -1
                || product.indexOf("google_sdk") != -1
                || product.indexOf("sdk") != -1
                || product.indexOf("sdk_x86") != -1
                || product.indexOf("vbox86p") != -1
                || device.indexOf("emulator") != -1
    }

    private fun startGoogleSignIn(clientId: String) {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestIdToken(clientId)
            .build()
        val googleSignInClient = GoogleSignIn.getClient(this, gso)
        googleSignInClient.signOut().addOnCompleteListener {
            val signInIntent = googleSignInClient.signInIntent
            startActivityForResult(signInIntent, RC_SIGN_IN)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == RC_SIGN_IN) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(data)
            try {
                val account = task.getResult(ApiException::class.java)
                val idToken = account?.idToken
                if (idToken != null) {
                    exchangeGoogleToken(idToken)
                } else {
                    runOnUiThread { 
                        Toast.makeText(this, "Google ID Token fehlt.", Toast.LENGTH_SHORT).show()
                        webView.evaluateJavascript("window.onGoogleSignInFailure ? window.onGoogleSignInFailure('Google ID Token fehlt.') : null", null)
                    }
                }
            } catch (e: ApiException) {
                runOnUiThread { 
                    Toast.makeText(this, "Google Login abgebrochen: ${e.statusCode}", Toast.LENGTH_SHORT).show()
                    val statusText = if (e.statusCode == 12501) "Google-Login abgebrochen." else "Google-Login fehlgeschlagen (${e.statusCode})."
                    webView.evaluateJavascript("window.onGoogleSignInFailure ? window.onGoogleSignInFailure('$statusText') : null", null)
                }
            }
        } else if (requestCode == RC_FILE_CHOOSER) {
            if (fileUploadCallback == null) return
            
            var results: Array<Uri>? = null
            if (resultCode == RESULT_OK && data != null) {
                val clipData = data.clipData
                if (clipData != null) {
                    results = Array(clipData.itemCount) { i ->
                        clipData.getItemAt(i).uri
                    }
                } else {
                    val uri = data.data
                    if (uri != null) {
                        results = arrayOf(uri)
                    }
                }
            }
            fileUploadCallback?.onReceiveValue(results)
            fileUploadCallback = null
        }
    }

    private fun exchangeGoogleToken(idToken: String) {
        val json = JSONObject()
        json.put("credential", idToken)
        
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
        
        val request = Request.Builder()
            .url("$backendUrl/api/auth/google")
            .post(body)
            .build()
            
        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { 
                    Toast.makeText(this@MainActivity, "Server-Authentifizierung fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show()
                    webView.evaluateJavascript("window.onGoogleSignInFailure ? window.onGoogleSignInFailure('Verbindung zum Server fehlgeschlagen.') : null", null)
                }
            }
            
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) {
                        runOnUiThread { 
                            Toast.makeText(this@MainActivity, "Fehler beim Google-Login im Backend.", Toast.LENGTH_LONG).show()
                            webView.evaluateJavascript("window.onGoogleSignInFailure ? window.onGoogleSignInFailure('Fehler bei der Anmeldung im Backend.') : null", null)
                        }
                        return
                    }
                    val bodyString = response.body?.string() ?: return
                    val tokenData = JSONObject(bodyString)
                    val jwtToken = tokenData.optString("access_token")
                    
                    if (jwtToken.isNotEmpty()) {
                        runOnUiThread {
                            injectJwtToken(jwtToken)
                        }
                    } else {
                        runOnUiThread {
                            Toast.makeText(this@MainActivity, "Google-Token-Austausch ungültig.", Toast.LENGTH_LONG).show()
                            webView.evaluateJavascript("window.onGoogleSignInFailure ? window.onGoogleSignInFailure('Ungültige Antwort vom Server.') : null", null)
                        }
                    }
                }
            }
        })
    }

    private fun injectJwtToken(jwtToken: String) {
        val js = """
            (function() {
                localStorage.setItem('velosia_token', '$jwtToken');
                localStorage.setItem('velosia_user_email', 'Google-Nutzer');
                window.location.reload();
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
        Toast.makeText(this, "Erfolgreich mit Google angemeldet!", Toast.LENGTH_SHORT).show()
    }

    // Ask the Play Store whether a newer version of the app is live. This only
    // works for Play-installed builds — Play performs the actual download/install
    // (flexible flow); on dev or sideloaded builds the request fails silently and
    // nothing is shown to the user.
    private fun checkForUpdates() {
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                val updateAvailable = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                if (updateAvailable && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                    try {
                        appUpdateManager.startUpdateFlowForResult(
                            info,
                            AppUpdateType.FLEXIBLE,
                            this,
                            RC_APP_UPDATE
                        )
                    } catch (e: Exception) {
                        // IntentSender failure — keep the current version silently.
                    }
                }
            }
            .addOnFailureListener {
                // Non-Play install or Play services unavailable: no update hint.
            }
    }

    // A flexible update downloads in the background; once Play reports it ready we
    // prompt the user to restart so Play can finish installing it.
    private fun showUpdateDownloadedPrompt() {
        Snackbar.make(webView, "Update heruntergeladen.", Snackbar.LENGTH_INDEFINITE)
            .setAction("Neu starten") { appUpdateManager.completeUpdate() }
            .show()
    }

    override fun onResume() {
        super.onResume()
        // If a flexible update finished downloading while the app was backgrounded,
        // re-surface the restart prompt.
        if (::appUpdateManager.isInitialized) {
            appUpdateManager.appUpdateInfo.addOnSuccessListener { info ->
                if (info.installStatus() == InstallStatus.DOWNLOADED) {
                    showUpdateDownloadedPrompt()
                }
            }
        }
    }

    override fun onDestroy() {
        if (::appUpdateManager.isInitialized) {
            appUpdateManager.unregisterListener(installStateListener)
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        webView.evaluateJavascript("window.onAndroidBack ? window.onAndroidBack() : false") { result ->
            if (result == "true") {
                // Handled by React app, do nothing
            } else {
                runOnUiThread {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        super.onBackPressed()
                    }
                }
            }
        }
    }
}
