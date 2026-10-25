package com.velosia.app

import com.google.android.play.core.install.model.InstallStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateProgressTest {

    @Test
    fun percentIsWholeAndCapped() {
        assertEquals(42, downloadPercent(42, 100))
        assertEquals(0, downloadPercent(-5, 100))
        assertEquals(100, downloadPercent(130, 100))
        assertNull(downloadPercent(10, 0))
    }

    @Test
    fun pendingLoadsWithoutSize() {
        assertEquals(UpdateDownload.Loading(null), downloadState(InstallStatus.PENDING, 0, 0))
        assertEquals(UpdateDownload.Loading(50), downloadState(InstallStatus.DOWNLOADING, 5, 10))
        assertEquals(UpdateDownload.Ready, downloadState(InstallStatus.DOWNLOADED, 10, 10))
    }

    @Test
    fun installingAndFailuresShowNothing() {
        assertNull(downloadState(InstallStatus.INSTALLING, 10, 10))
        assertNull(downloadState(InstallStatus.FAILED, 1, 10))
        assertNull(downloadState(InstallStatus.CANCELED, 1, 10))
    }

    @Test
    fun askedOncePerVersionForThreeDays() {
        val now = 10 * UPDATE_REASK_MS
        assertFalse(alreadyAsked(230, 0, 0, now))
        assertTrue(alreadyAsked(230, 230, now - 1000, now))
        assertTrue(alreadyAsked(229, 230, now - 1000, now))
        assertFalse(alreadyAsked(231, 230, now - 1000, now))
        assertFalse(alreadyAsked(230, 230, now - UPDATE_REASK_MS, now))
        // A clock that jumped backwards does not hold the question forever.
        assertFalse(alreadyAsked(230, 230, now + 1000, now))
    }
}
