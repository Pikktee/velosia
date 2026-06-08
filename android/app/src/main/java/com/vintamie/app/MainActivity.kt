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
    private var frontendUrl = "https://vintamie.henrikheil.net"
    private var backendUrl = "https://api.vintamie.henrikheil.net"

    private var activeDraftJson: String? = null
    private var activeImageUri: Uri? = null
    private var activePlatform: String? = null
    private var userZip: String? = null
    // Guards the automatic one-shot fill so it does not re-trigger on every SPA page event
    private var hasAutoFilled = false
    // Guards the automatic category pre-selection on the Kleinanzeigen step 1 page
    private var hasAutoCategory = false

    private val okHttpClient = OkHttpClient()
    
    private var isUpdateDialogShowing = false
    private val updateCheckHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val updateCheckRunnable = object : Runnable {
        override fun run() {
            checkForUpdates()
            updateCheckHandler.postDelayed(this, 900000) // Check every 15 minutes
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
        webView.addJavascriptInterface(VintamieBridge(), "VintamieBridge")

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
                    // On the actual form, fill (and submit) automatically once it has loaded.
                    if (isFormPage && !hasAutoFilled) {
                        hasAutoFilled = true
                        // The forms render dynamically; give them a moment before injecting.
                        webView.postDelayed({ injectAutofillScript(autoSubmit = true) }, 1200)
                    }
                    // On the category picker, try to auto-select the category via the
                    // keyword suggestion field so the user reaches the form hands-free.
                    if (isKleinanzeigenCategory && !hasAutoCategory) {
                        hasAutoCategory = true
                        webView.postDelayed({ injectCategorySelectScript() }, 1200)
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
            injectAutofillScript(autoSubmit = false)
        }

        // Close button: leave the external listing page and return to the dashboard
        fabClose.setOnClickListener {
            closeListingView()
        }

        // Load the frontend dashboard
        webView.loadUrl(frontendUrl)

        // Start periodic update checks
        startPeriodicUpdateChecks()
    }

    // Javascript Interface definition
    inner class VintamieBridge {
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
                    } catch (e: Exception) {
                        // Ignore malformed profile responses
                    }
                }
            }
        })
    }

    // Close the external listing page: drop the active draft session and return
    // to the Vintamie dashboard.
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

    // Injects Javascript on the Kleinanzeigen category picker (step 1). Kleinanzeigen has
    // no plain category field; instead it matches a keyword to a category via a suggestion
    // dropdown. We type our category (or, as a fallback, the title) and click the first
    // suggestion, which navigates to the form (step 2). If no suggestion can be clicked the
    // field stays prefilled so the user only needs a single tap.
    private fun injectCategorySelectScript() {
        val draftJson = activeDraftJson ?: return
        val escapedJson = draftJson.replace("\\", "\\\\").replace("'", "\\'")

        val js = """
            (function() {
                const draft = JSON.parse('$escapedJson');
                const keyword = (draft.category && draft.category.trim()) ? draft.category.trim() : (draft.title || '').trim();
                if (!keyword) return;

                function findInput() {
                    let el = document.querySelector("#pstad-keyword")
                        || document.querySelector("#postad-keyword")
                        || document.querySelector("input[name='keyword']")
                        || document.querySelector("input[type='search']");
                    if (el) return el;
                    const inputs = document.querySelectorAll("input[type='text'], input:not([type])");
                    for (const i of inputs) {
                        const p = (i.placeholder || '').toLowerCase();
                        if (p.includes('verkauf') || p.includes('was ') || p.includes('suchst') || p.includes('bieten') || p.includes('artikel')) {
                            return i;
                        }
                    }
                    return null;
                }

                let tries = 0;
                function start() {
                    tries++;
                    const input = findInput();
                    if (!input) {
                        if (tries < 20) setTimeout(start, 500);
                        return;
                    }
                    input.focus();
                    input.value = keyword;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                    setTimeout(pickSuggestion, 1500);
                }

                let pickTries = 0;
                function pickSuggestion() {
                    pickTries++;
                    const selectors = [
                        "#pstad-keyword-suggestions li",
                        "#postad-keyword-suggestions li",
                        "ul[role='listbox'] li[role='option']",
                        "ul[role='listbox'] li",
                        "[class*='uggestion'] li",
                        "[class*='uggestion'] a",
                        "li[role='option']",
                        "a[href*='p-kategorie']"
                    ];
                    let item = null;
                    for (const s of selectors) {
                        const el = document.querySelector(s);
                        if (el) { item = el; break; }
                    }
                    if (item) {
                        item.click();
                        return;
                    }
                    if (pickTries < 6) setTimeout(pickSuggestion, 1000);
                    // Otherwise: leave the field prefilled for a manual tap.
                }

                start();
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }

    // Injects Javascript to autofill fields, trigger the file upload chooser click and
    // (optionally) submit the listing automatically. The form on both platforms renders
    // dynamically, so the injected script polls for the fields before filling them.
    private fun injectAutofillScript(autoSubmit: Boolean) {
        val draftJson = activeDraftJson ?: return
        val escapedJson = draftJson.replace("\\", "\\\\").replace("'", "\\'")
        val zip = userZip?.replace("\\", "\\\\")?.replace("'", "\\'") ?: ""

        val js = """
            (function() {
                const draft = JSON.parse('$escapedJson');
                const userZip = '$zip';
                const autoSubmit = $autoSubmit;
                const isVinted = window.location.hostname.includes('vinted');

                function setVal(el, val) {
                    if (!el || val === undefined || val === null) return false;
                    try { el.focus(); } catch (e) {}
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }

                // --- Generic attribute (Zusatzfelder) matching --------------------
                function norm(s) {
                    return (s == null ? '' : String(s)).toLowerCase()
                        .replace(/[^a-z0-9äöüß]+/g, ' ').trim();
                }

                // Collect label-ish text describing a form control
                function labelTextFor(el) {
                    let txt = '';
                    if (el.id) {
                        const lab = document.querySelector("label[for='" + el.id + "']");
                        if (lab) txt += ' ' + lab.textContent;
                    }
                    txt += ' ' + (el.getAttribute('aria-label') || '');
                    txt += ' ' + (el.getAttribute('name') || '');
                    txt += ' ' + (el.getAttribute('placeholder') || '');
                    let node = el.parentElement;
                    let depth = 0;
                    while (node && depth < 3) {
                        if (node.tagName === 'LABEL' || node.tagName === 'LEGEND') {
                            txt += ' ' + node.textContent;
                        }
                        const lab = node.querySelector ? node.querySelector('label, legend') : null;
                        if (lab) txt += ' ' + lab.textContent;
                        node = node.parentElement; depth++;
                    }
                    return norm(txt);
                }

                function pickOption(sel, value) {
                    const nv = norm(value);
                    if (!nv) return null;
                    for (const opt of sel.options) {
                        if (norm(opt.textContent) === nv) return opt;
                    }
                    for (const opt of sel.options) {
                        const ot = norm(opt.textContent);
                        if (ot && opt.value && (ot.includes(nv) || nv.includes(ot))) return opt;
                    }
                    return null;
                }

                function parseAttributes() {
                    let a = draft.attributes;
                    if (!a) return {};
                    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { return {}; } }
                    return (a && typeof a === 'object') ? a : {};
                }

                function fillAttributes() {
                    const attrs = parseAttributes();
                    const entries = Object.keys(attrs).map(function(k){ return [k, attrs[k]]; });
                    if (entries.length === 0) return;

                    const selects = Array.from(document.querySelectorAll('select'));
                    const texts = Array.from(document.querySelectorAll("input[type='text'], input:not([type])"));

                    for (const pair of entries) {
                        const label = norm(pair[0]);
                        const value = pair[1] == null ? '' : String(pair[1]);
                        if (!label || !value) continue;

                        // Special-case Kleinanzeigen shipping toggle (often a checkbox)
                        if (label.indexOf('versand') !== -1) {
                            const wantsShip = norm(value).indexOf('moglich') !== -1 || norm(value).indexOf('versand') !== -1;
                            const boxes = document.querySelectorAll("input[type='checkbox'], input[type='radio']");
                            let toggled = false;
                            for (const b of boxes) {
                                if (labelTextFor(b).indexOf('versand') !== -1) {
                                    if (b.checked !== wantsShip) { b.click(); }
                                    toggled = true;
                                }
                            }
                            if (toggled) continue;
                        }

                        let done = false;
                        for (const sel of selects) {
                            if (sel.__vintamieKnown) continue;
                            if (labelTextFor(sel).indexOf(label) === -1) continue;
                            const opt = pickOption(sel, value);
                            if (opt) {
                                sel.value = opt.value;
                                sel.__vintamieKnown = true;
                                sel.dispatchEvent(new Event('change', { bubbles: true }));
                                done = true;
                                break;
                            }
                        }
                        if (done) continue;

                        for (const inp of texts) {
                            if (inp.__vintamieKnown) continue;
                            if (labelTextFor(inp).indexOf(label) === -1) continue;
                            setVal(inp, value);
                            inp.__vintamieKnown = true;
                            break;
                        }
                    }
                }

                let fillAttempts = 0;
                function fill() {
                    fillAttempts++;
                    let title, desc, price;
                    if (isVinted) {
                        title = document.querySelector("input[name='title']") || document.querySelector("input[placeholder*='titel']") || document.querySelector("input[id*='title']");
                        desc = document.querySelector("textarea[name='description']") || document.querySelector("textarea[placeholder*='beschreib']") || document.querySelector("textarea[id*='desc']");
                        price = document.querySelector("input[name='price']") || document.querySelector("input[placeholder*='0,00']") || document.querySelector("input[id*='price']");
                    } else {
                        title = document.querySelector("#postad-title") || document.querySelector("input[name='title']") || document.querySelector("input[id*='title']");
                        desc = document.querySelector("#pstad-descrptn") || document.querySelector("textarea[name='description']") || document.querySelector("textarea[id*='descr']");
                        price = document.querySelector("#pstad-price") || document.querySelector("input[name='price']") || document.querySelector("input[id*='price']");
                    }

                    // The form may not be rendered yet - retry for a few seconds.
                    if (!title && fillAttempts < 20) {
                        setTimeout(fill, 500);
                        return;
                    }

                    setVal(title, draft.title);
                    setVal(desc, draft.description);
                    if (title) title.__vintamieKnown = true;
                    if (desc) desc.__vintamieKnown = true;
                    if (price) price.__vintamieKnown = true;
                    if (draft.price !== undefined && draft.price !== null) {
                        setVal(price, String(Math.round(draft.price)));
                    }

                    if (!isVinted) {
                        // Festpreis (fixed price)
                        const priceRadios = document.querySelectorAll("input[name='priceType']");
                        for (let radio of priceRadios) {
                            if (radio.value === 'FIXED' || (radio.id && (radio.id.includes('fixed') || radio.id.includes('fest')))) {
                                radio.checked = true;
                                radio.dispatchEvent(new Event('change', { bubbles: true }));
                                break;
                            }
                        }
                        // Postcode (required for submission) from the user's saved profile
                        if (userZip) {
                            const postcode = document.querySelector("#postad-postcode") || document.querySelector("input[name='postcode']") || document.querySelector("input[id*='postcode']") || document.querySelector("input[placeholder*='PLZ']");
                            if (postcode) {
                                setVal(postcode, userZip);
                                postcode.__vintamieKnown = true;
                                postcode.dispatchEvent(new Event('blur', { bubbles: true }));
                            }
                        }
                        // Category-specific attributes ("Zusatzfelder"). They may render
                        // slightly after the core fields, so attempt a few times.
                        fillAttributes();
                        setTimeout(fillAttributes, 1500);
                        setTimeout(fillAttributes, 3500);
                    }

                    // Trigger the native file chooser to upload the draft photo.
                    const fileInput = document.querySelector("input[type='file']");
                    if (fileInput) { fileInput.click(); }

                    // Give the image upload and attribute fills time to settle, then
                    // submit if requested.
                    if (autoSubmit) {
                        setTimeout(trySubmit, 8000);
                    }
                }

                let submitAttempts = 0;
                function trySubmit() {
                    submitAttempts++;
                    let btn;
                    if (isVinted) {
                        btn = document.querySelector("button[data-testid*='submit']") || document.querySelector("button[type='submit']");
                    } else {
                        btn = document.querySelector("#pstad-submit") || document.querySelector("button[type='submit']");
                        if (!btn) {
                            const candidates = document.querySelectorAll("button, input[type='submit']");
                            for (let b of candidates) {
                                const t = (b.innerText || b.value || '').toLowerCase();
                                if (t.includes('anzeige aufgeben') || t.includes('veröffentlichen') || t.includes('einstellen')) { btn = b; break; }
                            }
                        }
                    }
                    if (btn) {
                        btn.click();
                    } else if (submitAttempts < 5) {
                        setTimeout(trySubmit, 1500);
                    }
                }

                fill();
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)

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
        if (isUpdateDialogShowing) return
        isUpdateDialogShowing = true

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Update verfügbar")
            .setMessage("Eine neue App-Version ($latestVersion) ist verfügbar. Möchtest du sie jetzt herunterladen und installieren?")
            .setPositiveButton("Installieren") { _, _ ->
                isUpdateDialogShowing = false
                downloadAndInstallApk()
            }
            .setNegativeButton("Später") { _, _ ->
                isUpdateDialogShowing = false
            }
            .setOnCancelListener {
                isUpdateDialogShowing = false
            }
            .show()
    }

    private fun downloadAndInstallApk() {
        // Show a progress dialog
        val progressDialog = android.app.ProgressDialog(this).apply {
            setTitle("Update wird heruntergeladen")
            setMessage("Bitte warten...")
            isIndeterminate = true
            setCancelable(false)
            show()
        }

        val request = Request.Builder()
            .url("$backendUrl/api/app/latest-apk")
            .build()

        okHttpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    progressDialog.dismiss()
                    Toast.makeText(this@MainActivity, "Download fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!response.isSuccessful) {
                        runOnUiThread {
                            progressDialog.dismiss()
                            Toast.makeText(this@MainActivity, "Download fehlgeschlagen (Fehler ${response.code}).", Toast.LENGTH_LONG).show()
                        }
                        return
                    }

                    try {
                        val apkFile = File(cacheDir, "vintamie-update.apk")
                        val fos = FileOutputStream(apkFile)
                        response.body?.byteStream()?.use { input ->
                            input.copyTo(fos)
                        }
                        fos.close()

                        runOnUiThread {
                            progressDialog.dismiss()
                            installApk(apkFile)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            progressDialog.dismiss()
                            Toast.makeText(this@MainActivity, "Installationsfehler: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        })
    }

    private fun installApk(apkFile: File) {
        val apkUri = FileProvider.getUriForFile(
            this,
            "com.vintamie.app.fileprovider",
            apkFile
        )

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        try {
            startActivity(installIntent)
        } catch (e: Exception) {
            Toast.makeText(this, "Paket-Installer konnte nicht geöffnet werden: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun startPeriodicUpdateChecks() {
        updateCheckHandler.removeCallbacks(updateCheckRunnable)
        updateCheckHandler.post(updateCheckRunnable)
    }

    override fun onResume() {
        super.onResume()
        checkForUpdates()
    }

    override fun onDestroy() {
        updateCheckHandler.removeCallbacks(updateCheckRunnable)
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
