package expo.modules.edocument

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Build
import android.os.Bundle
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
  private var nfcAdapter: NfcAdapter? = null

  private var scanPromise: Promise? = null
  private var readerCallback: NfcAdapter.ReaderCallback? = null

  private var documentType: String? = null
  private var bacKeyParameters: BacKeyParameters? = null
  private var scanChallenge: ByteArray? = null

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
      disableNfcReaderMode(activity)

      documentType = docType
      bacKeyParameters = Gson().fromJson(bacKeyParametersJson, BacKeyParameters::class.java)
      scanChallenge = challenge
      scanPromise = promise

      enableNfcReaderMode(activity)
    }

    OnDestroy {
      appContext.currentActivity?.let { disableNfcReaderMode(it) }
    }
  }

  private fun enableNfcReaderMode(activity: Activity) {
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

    nfcAdapter?.enableReaderMode(activity, callback, flags, options)
    sendEvent(DocumentScanEvents.REQUEST_PRESENT_PASSPORT.value)
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

    val promise = scanPromise ?: return
    val bacKey = bacKeyParameters
    val challenge = scanChallenge
    val activity = appContext.currentActivity

    if (bacKey == null || challenge == null) {
      scanPromise = null
      promise.reject(CodedException("handleTag", "Scan parameters missing", null))
      activity?.let { disableNfcReaderMode(it) }
      return
    }

    val isoDep = IsoDep.get(tag)
    if (isoDep == null) {
      scanPromise = null
      promise.reject(CodedException("handleTag", "Tag does not support IsoDep", null))
      activity?.let { disableNfcReaderMode(it) }
      return
    }

    // Give the card enough time for PACE's crypto round-trips.
    isoDep.timeout = 10_000

    val docScanner = DocumentScanner(isoDep, bacKey, challenge)

    try {
      val nfcDocument = when (documentType) {
        "I", "ID" -> {
          docScanner.scanIDCard(
            onAuthenticatingWithPassport = { sendEvent(DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT.value) },
            onReadingDataGroupProgress = { sendEvent(DocumentScanEvents.READING_DATA_GROUP_PROGRESS.value) },
            onActiveAuthentication = { sendEvent(DocumentScanEvents.ACTIVE_AUTHENTICATION.value) },
            onSuccessfulRead = { sendEvent(DocumentScanEvents.SUCCESSFUL_READ.value) },
            onDebugLog = { message ->
              sendEvent(DocumentScanEvents.DEBUG_LOG.value, mapOf("message" to message))
            },
          )
        }
        "P", "PASSPORT" -> {
          docScanner.scanPassport(
            onAuthenticatingWithPassport = { sendEvent(DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT.value) },
            onReadingDataGroupProgress = { sendEvent(DocumentScanEvents.READING_DATA_GROUP_PROGRESS.value) },
            onActiveAuthentication = { sendEvent(DocumentScanEvents.ACTIVE_AUTHENTICATION.value) },
            onSuccessfulRead = { sendEvent(DocumentScanEvents.SUCCESSFUL_READ.value) },
            onDebugLog = { message ->
              sendEvent(DocumentScanEvents.DEBUG_LOG.value, mapOf("message" to message))
            },
          )
        }
        else -> throw IllegalArgumentException("Invalid document type: '$documentType'. Use 'P' for passport or 'I' for ID card.")
      }

      val eDocument = EDocument.fromNfcDocumentModel(nfcDocument)
      val eDocumentJson = Gson().toJson(eDocument)
      scanPromise = null
      promise.resolve(eDocumentJson)
    } catch (e: Exception) {
      scanPromise = null
      sendEvent(DocumentScanEvents.SCAN_ERROR.value)
      promise.reject(CodedException("handleTag", e.message, e))
    } finally {
      activity?.let { disableNfcReaderMode(it) }
    }
  }
}
