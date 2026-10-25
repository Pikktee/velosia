package com.velosia.app

import com.google.android.play.core.install.model.InstallStatus

// Pure decisions behind the in-app update bar (no Android views), so they can be unit
// tested. Modelled on Maptale's update/UpdateDecision.kt: Play shows NO progress of its
// own for a flexible update — after "Aktualisieren" in Play's dialog nothing visibly
// happened until the download was done. The app has to draw both states itself.

/** What the update bar shows; `null` = no bar. */
sealed interface UpdateDownload {
    /**
     * Play is downloading. [percent] in whole percent, `null` while Play does not know
     * the size yet (the bar then runs indeterminate — "0 %" would look like a hang).
     * Whole numbers, not a fraction: Play fires many events per percent.
     */
    data class Loading(val percent: Int?) : UpdateDownload

    /** Downloaded, waits for the user to restart. */
    data object Ready : UpdateDownload
}

/** Share in whole percent, capped so an outlier in Play's numbers never exceeds 100. */
fun downloadPercent(bytesDownloaded: Long, totalBytes: Long): Int? =
    if (totalBytes <= 0) null
    else (bytesDownloaded.coerceAtLeast(0) * 100 / totalBytes).toInt().coerceIn(0, 100)

/**
 * Bar state for a Play install status. PENDING already counts as loading: between the
 * tap on "Aktualisieren" and the first byte there are often seconds that looked like a
 * button doing nothing. INSTALLING shows nothing (the app restarts right away), neither
 * does a failed/cancelled download (Play offers it again next time).
 */
fun downloadState(installStatus: Int, bytesDownloaded: Long, totalBytes: Long): UpdateDownload? =
    when (installStatus) {
        InstallStatus.PENDING -> UpdateDownload.Loading(null)
        InstallStatus.DOWNLOADING -> UpdateDownload.Loading(downloadPercent(bytesDownloaded, totalBytes))
        InstallStatus.DOWNLOADED -> UpdateDownload.Ready
        else -> null
    }

/**
 * After asking about a version (Play's flexible dialog), ask again at the earliest after
 * three days. Before, the dialog came back on every cold start — and MIUI or a swipe
 * from the recents kill the process often.
 */
const val UPDATE_REASK_MS = 3 * 24 * 60 * 60 * 1000L

/**
 * Was this version already asked about recently? `<=`, because asking about a newer
 * version covers the older one too. A clock jumping backwards never holds it forever.
 */
fun alreadyAsked(versionCode: Long, askedVersion: Long, askedAtMs: Long, nowMs: Long): Boolean {
    if (askedVersion <= 0 || versionCode > askedVersion) return false
    val since = nowMs - askedAtMs
    return since in 0 until UPDATE_REASK_MS
}
