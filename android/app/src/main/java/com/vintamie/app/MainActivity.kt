package com.vintamie.app

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
import okhttp3.*
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var fabFill: ExtendedFloatingActionButton
    
    private val RC_SIGN_IN = 9001
    
    // Server addresses (default to production for physical devices)
    private var frontendUrl = "https://vintamie.henrikheil.net"
    private var backendUrl = "https://api.vintamie.henrikheil.net"

    private var activeDraftJson: String? = null
    private var activeImageUri: Uri? = null
    private var activePlatform: String? = null

    private val okHttpClient = OkHttpClient()

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
        webView.addJavascriptInterface(VintamieBridge(), "VintamieBridge")

        // Setup WebViewClient
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep navigation within the WebView
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                
                // Show or hide the FAB based on the current URL
                if (url.contains("vinted.de/items/new") || 
                    url.contains("vinted.fr/items/new") ||
                    url.contains("kleinanzeigen.de/p-anzeige-aufgeben.html")
                ) {
                    if (activeDraftJson != null) {
                        fabFill.visibility = View.VISIBLE
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
                
                // If no active photo, return false to let default file picker run
                return false
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    // Grant WebRTC camera permission dynamically
                    request.grant(request.resources)
                }
            }
        }

        // Configure floating fill action button
        fabFill.setOnClickListener {
            injectAutofillScript()
        }

        // Load the frontend dashboard
        webView.loadUrl(frontendUrl)

        // Check for OTA updates
        checkForUpdates()
    }

    // Javascript Interface definition
    inner class VintamieBridge {
        @JavascriptInterface
        fun postToPlatform(draftId: Int, platform: String, token: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, "Lade Entwurf #$draftId...", Toast.LENGTH_SHORT).show()
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
                            Toast.makeText(this@MainActivity, "Fehler beim Laden des Entwurfs.", Toast.LENGTH_LONG).show()
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
                        val cacheFile = File(cacheDir, "vintamie_upload.jpg")
                        val fos = FileOutputStream(cacheFile)
                        fos.write(response.body?.bytes() ?: byteArrayOf())
                        fos.close()

                        // Get FileProvider URI
                        val fileUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "com.vintamie.app.fileprovider",
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
        val url = if (platform == "vinted") {
            "https://www.vinted.de/items/new"
        } else {
            "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html"
        }
        webView.loadUrl(url)
    }

    // Injects Javascript to autofill fields and trigger the file upload chooser click
    private fun injectAutofillScript() {
        val draftJson = activeDraftJson ?: return
        val escapedJson = draftJson.replace("'", "\\'")

        val js = """
            (function() {
                const draft = JSON.parse('$escapedJson');
                const isVinted = window.location.hostname.includes('vinted');
                
                if (isVinted) {
                    // Vinted Form Filling
                    const title = document.querySelector("input[name='title']") || document.querySelector("input[placeholder*='titel']") || document.querySelector("input[id*='title']");
                    if (title) { title.value = draft.title; title.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    const desc = document.querySelector("textarea[name='description']") || document.querySelector("textarea[placeholder*='beschreib']") || document.querySelector("textarea[id*='desc']");
                    if (desc) { desc.value = draft.description; desc.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    const price = document.querySelector("input[name='price']") || document.querySelector("input[placeholder*='0,00']") || document.querySelector("input[id*='price']");
                    if (price) { price.value = Math.round(draft.price); price.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    // Click file upload element to trigger onShowFileChooser
                    const fileInput = document.querySelector("input[type='file']");
                    if (fileInput) {
                        fileInput.click();
                    }
                } else {
                    // Kleinanzeigen Form Filling
                    const title = document.querySelector("#postad-title") || document.querySelector("input[name='title']");
                    if (title) { title.value = draft.title; title.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    const desc = document.querySelector("#pstad-descrptn") || document.querySelector("textarea[name='description']");
                    if (desc) { desc.value = draft.description; desc.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    const price = document.querySelector("#pstad-price") || document.querySelector("input[name='price']");
                    if (price) { price.value = Math.round(draft.price); price.dispatchEvent(new Event('input', { bubbles: true })); }
                    
                    const priceRadios = document.querySelectorAll("input[name='priceType']");
                    if (priceRadios) {
                        for (let radio of priceRadios) {
                            if (radio.value === "FIXED") {
                                radio.checked = true;
                                radio.dispatchEvent(new Event('change', { bubbles: true }));
                                break;
                            }
                        }
                    }
                    
                    // Trigger image input click
                    const fileInput = document.querySelector("input[type='file']");
                    if (fileInput) {
                        fileInput.click();
                    }
                }
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
        
        // Hide FAB after filling
        fabFill.visibility = View.GONE
        activeDraftJson = null
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
                    runOnUiThread { Toast.makeText(this, "Google ID Token fehlt.", Toast.LENGTH_SHORT).show() }
                }
            } catch (e: ApiException) {
                runOnUiThread { Toast.makeText(this, "Google Login abgebrochen: ${e.statusCode}", Toast.LENGTH_SHORT).show() }
            }
        }
    }

    private fun exchangeGoogleToken(idToken: String) {
        val json = JSONObject()
        json.put("credential", idToken)
        
        val body = RequestBody.create(
            MediaType.parse("application/json; charset=utf-8"),
            json.toString()
        )
        
        val request = Request.Builder()
            .url("$backendUrl/api/auth/google")
            .post(body)
            .build()
            
        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Server-Authentifizierung fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show() }
            }
            
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) {
                        runOnUiThread { Toast.makeText(this@MainActivity, "Fehler beim Google-Login im Backend.", Toast.LENGTH_LONG).show() }
                        return
                    }
                    val bodyString = response.body?.string() ?: return
                    val tokenData = JSONObject(bodyString)
                    val jwtToken = tokenData.optString("access_token")
                    
                    if (jwtToken.isNotEmpty()) {
                        runOnUiThread {
                            injectJwtToken(jwtToken)
                        }
                    }
                }
            }
        })
    }

    private fun injectJwtToken(jwtToken: String) {
        val js = """
            (function() {
                localStorage.setItem('vintamie_token', '$jwtToken');
                localStorage.setItem('vintamie_user_email', 'Google-Nutzer');
                window.location.reload();
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
        Toast.makeText(this, "Erfolgreich mit Google angemeldet!", Toast.LENGTH_SHORT).show()
    }

    private fun checkForUpdates() {
        val request = Request.Builder()
            .url("$backendUrl/api/app/version")
            .build()

        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // Ignore silent failure so app works offline
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) return
                    val bodyString = response.body?.string() ?: return
                    try {
                        val json = JSONObject(bodyString)
                        val serverVersion = json.getString("version")
                        
                        val packageInfo = packageManager.getPackageInfo(packageName, 0)
                        val localVersion = packageInfo.versionName

                        if (isNewerVersion(localVersion, serverVersion)) {
                            runOnUiThread {
                                showUpdateDialog(serverVersion)
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
        })
    }

    private fun isNewerVersion(local: String?, server: String): Boolean {
        if (local == null) return true
        val localParts = local.split(".")
        val serverParts = server.split(".")
        val length = maxOf(localParts.size, serverParts.size)
        for (i in 0 until length) {
            val localPart = if (i < localParts.size) localParts[i].toIntOrNull() ?: 0 else 0
            val serverPart = if (i < serverParts.size) serverParts[i].toIntOrNull() ?: 0 else 0
            if (serverPart > localPart) return true
            if (localPart > serverPart) return false
        }
        return false
    }

    private fun showUpdateDialog(latestVersion: String) {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Update verfügbar")
            .setMessage("Eine neue App-Version ($latestVersion) ist verfügbar. Möchtest du sie jetzt herunterladen?")
            .setPositiveButton("Herunterladen") { _, _ ->
                val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse("$backendUrl/api/app/latest-apk"))
                startActivity(browserIntent)
            }
            .setNegativeButton("Später", null)
            .show()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
