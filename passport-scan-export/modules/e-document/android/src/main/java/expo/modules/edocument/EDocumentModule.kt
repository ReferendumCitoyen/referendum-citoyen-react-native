package expo.modules.edocument

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
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

  SCAN_STOPPED("SCAN_STOPPED"),
}

class EDocumentModule : Module() {
  private var nfcAdapter: NfcAdapter? = null

  private var scanPromise: Promise? = null

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
      DocumentScanEvents.SCAN_STOPPED.value,
    )

    Name("EDocument")

    AsyncFunction("scanDocument") { bacKeyParametersJson: String, challenge: ByteArray, promise: Promise ->
      val activity = appContext.reactContext ?: run {
        throw IllegalStateException("No current activity found")
      }

      nfcAdapter = NfcAdapter.getDefaultAdapter(activity)

      if (nfcAdapter == null || !nfcAdapter!!.isEnabled) {
        throw IllegalStateException("NFC is not available or not enabled")
      }

      // Enable foreground dispatch for NFC
      appContext.currentActivity?.let {
        enableNfcForegroundDispatch(it)
      } ?: run {
        throw IllegalStateException("No current activity found")
      }

      bacKeyParameters = Gson().fromJson(bacKeyParametersJson, BacKeyParameters::class.java)
      scanChallenge = challenge

      scanPromise = promise
    }

    OnNewIntent { intent ->
      scanPromise?.let { handleNfcIntent(intent, it) }
    }

    OnDestroy {
      disableNfcForegroundDispatch()
    }
  }

  private fun handleNfcIntent(intent: Intent?, promise: Promise) {
    sendEvent(DocumentScanEvents.SCAN_STARTED.value)

    val tag = intent?.getParcelableExtra<Tag>(NfcAdapter.EXTRA_TAG)

    if (!(intent?.action == NfcAdapter.ACTION_TAG_DISCOVERED || intent?.action == NfcAdapter.ACTION_TECH_DISCOVERED)) return

    if (tag == null) {
      return
    }

    val isoDep = IsoDep.get(tag)

    if (
      isoDep == null ||
      bacKeyParameters == null ||
      scanChallenge == null
    ) return

    val docScanner = DocumentScanner(
      isoDep,
      bacKeyParameters!!,
      scanChallenge!!
    )

    try {
      val nfcDocument = docScanner.scanPassport(
        onAuthenticatingWithPassport = {
          sendEvent(DocumentScanEvents.AUTHENTICATING_WITH_PASSPORT.value)
        },
        onReadingDataGroupProgress = {
          sendEvent(DocumentScanEvents.READING_DATA_GROUP_PROGRESS.value)
        },
        onActiveAuthentication = {
          sendEvent(DocumentScanEvents.ACTIVE_AUTHENTICATION.value)
        },
        onSuccessfulRead = {
          sendEvent(DocumentScanEvents.SUCCESSFUL_READ.value)
        },
      )

      val eDocument = EDocument.fromNfcDocumentModel(nfcDocument)

      val eDocumentJson = Gson().toJson(eDocument)
      promise.resolve(eDocumentJson)
    } catch(e: Exception) {
      sendEvent(DocumentScanEvents.SCAN_ERROR.value)
      promise.reject(CodedException("handleNfcIntent", e.message, e))
    }
  }

  private fun enableNfcForegroundDispatch(activity: Activity) {
    val intent = Intent(activity.applicationContext, activity::class.java)
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    val pendingIntent = PendingIntent.getActivity(activity, 0, intent, PendingIntent.FLAG_MUTABLE)
    val filters = arrayOf(IntentFilter(NfcAdapter.ACTION_TECH_DISCOVERED))
    val techList = arrayOf(arrayOf(IsoDep::class.java.name))
    nfcAdapter?.enableForegroundDispatch(activity, pendingIntent, filters, techList)

    sendEvent(DocumentScanEvents.REQUEST_PRESENT_PASSPORT.value)
  }

  private fun disableNfcForegroundDispatch() {
    appContext.currentActivity?.let { nfcAdapter?.disableForegroundDispatch(it) }
    sendEvent(DocumentScanEvents.SCAN_STOPPED.value)
  }
}
