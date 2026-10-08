package com.velosia.app

import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

// Verifies the web-delivered autofill engine before the shell injects it. deploy.py
// signs the exact bytes of autofill-engine.js (ECDSA P-256, SHA-256, DER signature,
// base64) and publishes the signature next to it as autofill-engine.js.sig.
// Pure JVM code (no Android APIs) so it can be exercised off-device.
object EngineVerifier {

    // Public half of the engine signing key (SubjectPublicKeyInfo, base64 DER).
    private const val PUBLIC_KEY_B64 =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEosPqOHmOom9PoUADLkAxlU1FpRVu" +
        "MzEp7sWplnm1jsOn3GnLnT+BeEJi/ZNw1j8ANce128N2PSnsiJ+6UjWyGQ=="

    private val publicKey: PublicKey by lazy {
        val der = Base64.getDecoder().decode(PUBLIC_KEY_B64)
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der))
    }

    fun verify(data: ByteArray, signatureB64: String): Boolean = try {
        val sig = Base64.getDecoder().decode(signatureB64.filterNot { it.isWhitespace() })
        if (sig.isEmpty() || sig.size > 128) {
            false
        } else {
            val v = Signature.getInstance("SHA256withECDSA")
            v.initVerify(publicKey)
            v.update(data)
            v.verify(sig)
        }
    } catch (e: Exception) {
        false
    }

    private val versionRegex = Regex("""var\s+VERSION\s*=\s*["'](\d+(?:\.\d+){0,3})["']""")

    // Engine version as declared in the script (`var VERSION = "x.y.z"`), or null.
    fun versionOf(js: String): String? = versionRegex.find(js)?.groupValues?.get(1)

    fun compareVersions(a: String, b: String): Int {
        val pa = a.split('.').map { it.toIntOrNull() ?: 0 }
        val pb = b.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = pa.getOrElse(i) { 0 }.compareTo(pb.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }
}
