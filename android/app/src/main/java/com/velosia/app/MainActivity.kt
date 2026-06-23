package com.velosia.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
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
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var fabFill: ExtendedFloatingActionButton
    private lateinit var fabClose: ExtendedFloatingActionButton

    private val RC_SIGN_IN = 9001
    private val RC_FILE_CHOOSER = 9002
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    // Server addresses (default to production for physical devices)
    private var frontendUrl = "https://velosia.henrikheil.net"
    private var backendUrl = "https://api.velosia.henrikheil.net"

    private var activeDraftJson: String? = null
    private var activeImageUri: Uri? = null
    private var activePlatform: String? = null
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
        fabFill = findViewById(R.id.fabFill)
        fabClose = findViewById(R.id.fabClose)

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
                    fabFill.visibility = View.VISIBLE
                    // On the actual form, fill once it has loaded. Whether it ALSO
                    // submits depends on the user's "publish automatically" setting
                    // (default off -> the user reviews and clicks publish himself).
                    if (isFormPage && !hasAutoFilled) {
                        hasAutoFilled = true
                        // The forms render dynamically; give them a moment before injecting.
                        webView.postDelayed({ injectAutofill(autoSubmit = autoSubmitSetting) }, 1200)
                    }
                    // On the category picker, let the engine pre-select the category via
                    // the keyword suggestion field so the user reaches the form hands-free.
                    if (isKleinanzeigenCategory && !hasAutoCategory) {
                        hasAutoCategory = true
                        webView.postDelayed({ injectAutofill(autoSubmit = false) }, 1200)
                    }
                } else {
                    fabFill.visibility = View.GONE
                }
            }
        }

        // Setup WebChromeClient to handle automatic image upload injection & camera permission
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                // Intercept file chooser and supply the draft photo programmatically
                activeImageUri?.let { uri ->
                    filePathCallback.onReceiveValue(arrayOf(uri))
                    // Clear the URI so next file chooser clicks can open standard dialog
                    activeImageUri = null
                    Toast.makeText(this@MainActivity, "Foto automatisch hochgeladen!", Toast.LENGTH_SHORT).show()
                    return true
                }
                
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

            override fun getDefaultVideoPoster(): android.graphics.Bitmap? {
                return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
            }
        }

        // Configure floating fill action button (manual fill, no auto-submit so the
        // user can review before publishing)
        fabFill.setOnClickListener {
            injectAutofill(autoSubmit = false)
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
    }

    // Fetch draft metadata and photo from local backend
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
                    val json = JSONObject(bodyString)
                    val imagePath = json.optString("image_path")

                    activeDraftJson = bodyString
                    activePlatform = platform

                    if (imagePath.isNotEmpty()) {
                        downloadImageAndNavigate(imagePath, platform)
                    } else {
                        runOnUiThread {
                            activeImageUri = null
                            navigateToPlatformListing(platform)
                        }
                    }
                }
            }
        })
    }

    // Download the draft photo to temporary cache dir and generate shareable content:// URI
    private fun downloadImageAndNavigate(imagePath: String, platform: String) {
        val url = if (imagePath.startsWith("http")) imagePath else "$backendUrl$imagePath"
        
        val request = Request.Builder().url(url).build()
        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Bild konnte nicht geladen werden.", Toast.LENGTH_SHORT).show()
                    navigateToPlatformListing(platform)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) {
                        runOnUiThread { navigateToPlatformListing(platform) }
                        return
                    }

                    try {
                        val cacheFile = File(cacheDir, "velosia_upload.jpg")
                        val fos = FileOutputStream(cacheFile)
                        fos.write(response.body?.bytes() ?: byteArrayOf())
                        fos.close()

                        // Get FileProvider URI
                        val fileUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "com.velosia.app.fileprovider",
                            cacheFile
                        )

                        runOnUiThread {
                            activeImageUri = fileUri
                            navigateToPlatformListing(platform)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            Toast.makeText(this@MainActivity, "Fehler beim Speichern des Bildes: ${e.message}", Toast.LENGTH_LONG).show()
                            navigateToPlatformListing(platform)
                        }
                    }
                }
            }
        })
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
        activeImageUri = null
        activePlatform = null
        hasAutoFilled = false
        hasAutoCategory = false
        fabFill.visibility = View.GONE
        fabClose.visibility = View.GONE
        webView.loadUrl(frontendUrl)
    }

    // Reads the shared autofill engine JS (bundled as an asset; the exact same
    // file the browser extension uses). Cached after the first read.
    private fun readEngineJs(): String {
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
    // fills the fields with a React/Vue-safe native value setter, triggers the
    // photo file chooser (intercepted in onShowFileChooser to supply the draft
    // photo), shows the result overlay and — only when autoSubmit is true —
    // publishes the listing automatically.
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
                        imageMode: 'native',
                        showOverlay: true
                    });
                } catch (e) { console.error('Velosia autofill failed', e); }
            })();
        """.trimIndent()

        webView.evaluateJavascript(engine) {
            webView.evaluateJavascript(caller, null)
        }

        // Keep the draft loaded so the manual FAB can be used to retry if needed.
        fabFill.visibility = View.GONE
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
