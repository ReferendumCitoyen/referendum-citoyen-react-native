package expo.modules.edocument

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.google.gson.Gson
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.bouncycastle.openssl.jcajce.JcaPEMWriter
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.DG15File
import java.io.StringWriter
import java.security.PublicKey
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicInteger

fun X509Certificate.convertToPem(): String {
  val stringWriter = StringWriter()
  JcaPEMWriter(stringWriter).use { pemWriter ->
    pemWriter.writeObject(this)
  }
  return stringWriter.toString()
}

fun PublicKey.publicKeyToPem(): String {
  val base64PubKey = Base64.encodeToString(this.encoded, Base64.DEFAULT)

  return "-----BEGIN PUBLIC KEY-----\n" +
    base64PubKey.replace("(.{64})".toRegex(), "$1\n") +
    "\n-----END PUBLIC KEY-----\n"
}

fun String.decodeHexString(): ByteArray {
  check(length % 2 == 0) {
    "Must have an even length"
  }

  return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}

enum class DocumentScanEvents(val value: String) {
  SCAN_STARTED("SCAN_STARTED"),

  REQUEST_PRESENT_PASSPORT("REQUEST_PRESENT_PASSPORT"),
  AUTHENTICATING_WITH_PASSPORT("AUTHENTICATING_WITH_PASSPORT"),
  READING_DATA_GROUP_PROGRESS("READING_DATA_GROUP_PROGRESS"),
  ACTIVE_AUTHENTICATION("ACTIVE_AUTHENTICATION"),
  SUCCESSFUL_READ("SUCCESSFUL_READ"),
  SCAN_ERROR("SCAN_ERROR"),
  DEBUG_LOG("DEBUG_LOG"),

  SCAN_STOPPED("SCAN_STOPPED"),
}

class EDocumentModule : Module() {
  companion object {
    // Time given to the NFC controller to apply a new discovery configuration
    // before we arm reader mode again. Without it, a card tapped immediately
    // after pressing "scan" can land on the outgoing configuration and be lost.
    private const val READER_SETTLE_MS = 400L
  }

  private var nfcAdapter: NfcAdapter? = null

  private var scanPromise: Promise? = null
  private var readerCallback: NfcAdapter.ReaderCallback? = null

  private var documentType: String? = null
  private var bacKeyParameters: BacKeyParameters? = null
  private var scanChallenge: ByteArray? = null

  // Bumped by every scanDocument call. handleTag runs on reader mode's own
  // background thread and can still be inside a 10 s IsoDep exchange when the
  // user gives up and taps retry, so it captures this value on entry and
  // treats itself as superseded once the counter moves on. Without that guard
  // a slow first attempt finishing late would null out the *second* attempt's
  // promise and, from its finally block, tear down the second attempt's
  // freshly armed reader session — mid-authentication. Reported as "once you
  // have failed once it stops the next read at 35%" (35% is exactly the
  // authenticating checkpoint on the JS progress bar).
  private val scanGeneration = AtomicInteger(0)

  override fun definition() = ModuleDefinition {
    Events(
      DocumentScanEvents.SCAN_STARTED.value,
      DocumentScanEvents.REQUEST_PRESENT_PASSPORT.value,
      DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT.value,
      DocumentScanEvents.READING_DATA_GROUP_PROGRESS.value,
      DocumentScanEvents.ACTIVE_AUTHENTICATION.value,
      DocumentScanEvents.SUCCESSFUL_READ.value,
      DocumentScanEvents.SCAN_ERROR.value,
      DocumentScanEvents.DEBUG_LOG.value,
      DocumentScanEvents.SCAN_STOPPED.value,
    )

    Name("EDocument")

    AsyncFunction("scanDocument") { docType: String, bacKeyParametersJson: String, challenge: ByteArray, promise: Promise ->
      val activity = appContext.currentActivity ?: run {
        throw IllegalStateException("No current activity found")
      }

      nfcAdapter = NfcAdapter.getDefaultAdapter(activity)

      if (nfcAdapter == null || !nfcAdapter!!.isEnabled) {
        throw IllegalStateException("NFC is not available or not enabled")
      }

      // If a previous scan is still live, tear it down before starting a new one.
      // Re-arming needs a settling delay; a first arm does not reconfigure
      // anything, so it can go live immediately.
      val wasArmed = cancelActiveScan(activity)

      documentType = docType
      bacKeyParameters = Gson().fromJson(bacKeyParametersJson, BacKeyParameters::class.java)
      scanChallenge = challenge
      scanPromise = promise

      enableNfcReaderMode(activity, if (wasArmed) READER_SETTLE_MS else 0L)
    }

    // Lets JS release an in-flight scan without starting a new one — e.g. the
    // 30 s timeout in Step6.tsx firing while the native reader session is
    // still armed. Shares cancelActiveScan with scanDocument's own self-cancel
    // (see that function's doc comment), so the two paths behave identically.
    AsyncFunction("cancelScan") { promise: Promise ->
      appContext.currentActivity?.let { cancelActiveScan(it) }
      promise.resolve(null)
    }

    OnDestroy {
      appContext.currentActivity?.let { disableNfcReaderMode(it) }
    }
  }

  // Retires any scan still in flight: bumps scanGeneration so a still-running
  // handleTag treats itself as superseded (see scanGeneration's doc comment)
  // and tears down the reader session. Returns whether a session was armed,
  // so callers that re-arm afterwards (scanDocument) know whether to apply
  // the re-arm settling delay.
  //
  // Deliberately does NOT reject/resolve the superseded scanPromise: its
  // handleTag may still be running and will settle that promise itself when
  // its APDUs fail. Settling it here too would hit PromiseImpl's
  // checkIfWasSettled, which throws PromiseAlreadySettledException in release
  // builds — on the NFC reader thread, so it would take the app down. Leaving
  // it pending is harmless: JS has already raced away from it, whether via
  // scanDocument's own Promise.race timeout or by calling cancelScan directly.
  private fun cancelActiveScan(activity: Activity): Boolean {
    val wasArmed = readerCallback != null
    scanGeneration.incrementAndGet()
    disableNfcReaderMode(activity)
    return wasArmed
  }

  // settleMs delays arming so the NFC controller can finish applying the new
  // discovery configuration. Re-arming (disableReaderMode -> enableReaderMode)
  // in the same tick left a window where a card tapped immediately was picked
  // up by the outgoing configuration — delivered as an intent we don't handle,
  // and silently dropped. Symptom: "if you tap the card too quickly it fails".
  private fun enableNfcReaderMode(activity: Activity, settleMs: Long = 0L) {
    // Reader mode (CoreNFC-equivalent on Android): the callback fires on a
    // dedicated background thread with exclusive IsoDep access, bypassing
    // Android's intent system and main thread entirely. This is what apps
    // that successfully read French CNIe cards on Android use.
    val callback = NfcAdapter.ReaderCallback { tag ->
      handleTag(tag)
    }
    readerCallback = callback

    val flags =
      NfcAdapter.FLAG_READER_NFC_A or
      NfcAdapter.FLAG_READER_NFC_B or
      NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK

    // Default presence-check delay is aggressive (~125ms) and drops sessions
    // on slight card motion. 2s keeps the session alive through the full PACE
    // + DG read flow.
    val options = Bundle().apply {
      putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 2000)
    }

    val arm = Runnable {
      // Foreground dispatch and reader mode are competing discovery paths.
      // disableNfcReaderMode() re-arms dispatch to keep other NFC apps from
      // grabbing a lingering card, so it must be torn down again here before
      // reader mode goes live — otherwise an early tap can still be routed to
      // the intent path and lost.
      try {
        nfcAdapter?.disableForegroundDispatch(activity)
      } catch (_: Exception) {
        // Activity may not be resumed — non-fatal.
      }
      nfcAdapter?.enableReaderMode(activity, callback, flags, options)
      // Only now is the reader actually listening — this event is what tells
      // the UI to prompt "present your card".
      sendEvent(DocumentScanEvents.REQUEST_PRESENT_PASSPORT.value)
    }

    if (settleMs > 0) {
      Handler(Looper.getMainLooper()).postDelayed(arm, settleMs)
    } else {
      arm.run()
    }
  }

  private fun disableNfcReaderMode(activity: Activity) {
    if (readerCallback != null) {
      try {
        nfcAdapter?.disableReaderMode(activity)
      } catch (_: Exception) {
        // disableReaderMode can throw if the activity is already torn down; ignore.
      }
      readerCallback = null
      sendEvent(DocumentScanEvents.SCAN_STOPPED.value)

      // Reclaim NFC dispatch for our activity. Without this, Android resumes
      // its default intent dispatch — if the user's card is still near the
      // phone (very common right after a successful scan), other installed
      // NFC apps (Satodime, Yubico, wallets…) win the chooser dialog.
      // Routing stray tag events back into our own activity silently drops
      // them because we do not handle the NFC intent.
      try {
        val intent = Intent(activity, activity.javaClass).apply {
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
          PendingIntent.FLAG_MUTABLE
        else
          0
        val pi = PendingIntent.getActivity(activity, 0, intent, piFlags)
        nfcAdapter?.enableForegroundDispatch(activity, pi, null, null)
      } catch (_: Exception) {
        // Activity may be in a weird state — non-fatal.
      }
    }
  }

  private fun handleTag(tag: Tag) {
    sendEvent(DocumentScanEvents.SCAN_STARTED.value)

    // Everything this scan needs is captured up front: these fields are
    // reassigned by the next scanDocument call, and this method can outlive
    // its own scan (see scanGeneration). `promise` is a local val, so a
    // superseded run still settles the promise it actually owns — it just
    // must not touch shared state or the reader session any more.
    val generation = scanGeneration.get()
    val isCurrentScan = { scanGeneration.get() == generation }
    val promise = scanPromise ?: return
    val docType = documentType
    val bacKey = bacKeyParameters
    val challenge = scanChallenge
    val activity = appContext.currentActivity

    // Clears the shared promise slot and releases the reader session, but only
    // while this run is still the current one.
    val releaseIfCurrent = {
      if (isCurrentScan()) {
        scanPromise = null
        activity?.let { disableNfcReaderMode(it) }
      }
    }

    // Progress events are addressed to whichever scan the user is watching, so
    // a superseded run must stay silent — otherwise its late SUCCESSFUL_READ
    // would drive the live scan's progress bar to 100%, and its SCAN_ERROR
    // would reset that bar to 0 (see the listener in Step6.tsx).
    val sendIfCurrent = { event: DocumentScanEvents ->
      if (isCurrentScan()) {
        sendEvent(event.value)
      }
    }

    if (bacKey == null || challenge == null) {
      releaseIfCurrent()
      promise.reject(CodedException("handleTag", "Scan parameters missing", null))
      return
    }

    val isoDep = IsoDep.get(tag)
    if (isoDep == null) {
      releaseIfCurrent()
      promise.reject(CodedException("handleTag", "Tag does not support IsoDep", null))
      return
    }

    // Give the card enough time for PACE's crypto round-trips.
    isoDep.timeout = 10_000

    val docScanner = DocumentScanner(isoDep, bacKey, challenge)

    // DEBUG_LOG forwards raw scan diagnostics (incl. full APDU TX/RX
    // transcripts via LoggingCardService) to JS, where they can reach the
    // in-memory log buffer and a user-mailed error report. Only emit on
    // debuggable builds — never in a release / Play Store build (DPIA R5).
    val debugLoggingEnabled = activity != null &&
      (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    try {
      val nfcDocument = when (docType) {
        "I", "ID" -> {
          docScanner.scanIDCard(
            onAuthenticatingWithPassport = { sendIfCurrent(DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT) },
            onReadingDataGroupProgress = { sendIfCurrent(DocumentScanEvents.READING_DATA_GROUP_PROGRESS) },
            onActiveAuthentication = { sendIfCurrent(DocumentScanEvents.ACTIVE_AUTHENTICATION) },
            onSuccessfulRead = { sendIfCurrent(DocumentScanEvents.SUCCESSFUL_READ) },
            onDebugLog = { message ->
              if (debugLoggingEnabled) {
                sendEvent(DocumentScanEvents.DEBUG_LOG.value, mapOf("message" to message))
              }
            },
          )
        }
        "P", "PASSPORT" -> {
          docScanner.scanPassport(
            onAuthenticatingWithPassport = { sendIfCurrent(DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT) },
            onReadingDataGroupProgress = { sendIfCurrent(DocumentScanEvents.READING_DATA_GROUP_PROGRESS) },
            onActiveAuthentication = { sendIfCurrent(DocumentScanEvents.ACTIVE_AUTHENTICATION) },
            onSuccessfulRead = { sendIfCurrent(DocumentScanEvents.SUCCESSFUL_READ) },
            onDebugLog = { message ->
              if (debugLoggingEnabled) {
                sendEvent(DocumentScanEvents.DEBUG_LOG.value, mapOf("message" to message))
              }
            },
          )
        }
        else -> throw IllegalArgumentException("Invalid document type: '$docType'. Use 'P' for passport or 'I' for ID card.")
      }

      val eDocument = EDocument.fromNfcDocumentModel(nfcDocument)
      val eDocumentJson = Gson().toJson(eDocument)
      promise.resolve(eDocumentJson)
    } catch (e: Exception) {
      // Only the current scan may report failure to the UI: a superseded run
      // firing SCAN_ERROR would reset the progress bar of the scan the user is
      // actually watching.
      if (isCurrentScan()) {
        sendEvent(DocumentScanEvents.SCAN_ERROR.value)
      }
      promise.reject(CodedException("handleTag", e.message, e))
    } finally {
      releaseIfCurrent()
    }
  }
}
