package expo.modules.edocument

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.nfc.tech.IsoDep
import com.gemalto.jp2.JP2Decoder
import net.sf.scuba.smartcards.CardService
import org.bouncycastle.asn1.cms.SignedData
import org.jmrtd.BACKey
import org.jmrtd.PACEKeySpec
import org.jmrtd.PassportService
import org.jmrtd.lds.CardAccessFile
import org.jmrtd.lds.CardSecurityFile
import org.jmrtd.lds.PACEInfo
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.DG11File
import org.jmrtd.lds.icao.DG15File
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.DG2File
import org.jmrtd.lds.icao.MRZInfo
import org.jmrtd.lds.iso19794.FaceImageInfo
import org.jnbis.WsqDecoder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.InputStream
import android.util.Base64
import java.util.Locale

fun String.addCharAtIndex(char: Char, index: Int) =
  StringBuilder(this).apply { insert(index, char) }.toString()

fun ByteArray.toBase64(): String = Base64.encodeToString(this, Base64.DEFAULT)

fun String.toFixedPersonalNumberMrzData(personalNumber: String?): String {
  if (personalNumber.isNullOrEmpty()) {
    return this
  }
  var firstPart =
    this.split(personalNumber.toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()[0]
  var restPart =
    this.split(personalNumber.toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()[1]
  if (firstPart.lastIndexOf("<") < 10) {
    firstPart += "<"
  }
  if (restPart.indexOf("<<<<") == 0) {
    restPart = restPart.substring(1)
  }
  return firstPart + personalNumber + restPart
}

@Throws(IOException::class)
fun FaceImageInfo.decodeImage(mimeType: String, inputStream: InputStream?): Bitmap {
  val mimeTypeLower = mimeType.lowercase(Locale.getDefault())
  return when (mimeTypeLower) {
    "image/jp2", "image/jpeg2000" -> {
      JP2Decoder(inputStream).decode()
    }

    "image/x-wsq" -> {
      val wsqDecoder = WsqDecoder()
      val bitmap = wsqDecoder.decode(inputStream)
      val byteData = bitmap.pixels
      val intData = IntArray(byteData.size)
      for (j in byteData.indices) {
        intData[j] = -0x1000000 or
          (byteData[j].toInt() and (0xFF shl 16)) or
          (byteData[j].toInt() and (0xFF shl 8)) or (byteData[j].toInt() and 0xFF)
      }
      Bitmap.createBitmap(
        intData,
        0,
        bitmap.width,
        bitmap.width,
        bitmap.height,
        Bitmap.Config.ARGB_8888
      )
    }

    else -> {
      BitmapFactory.decodeStream(inputStream)
    }
  }
}

fun FaceImageInfo.toBase64Image(): String? {
  try {
    val imageLength = this.imageLength
    val dataInputStream = DataInputStream(this.imageInputStream)
    val buffer = ByteArray(imageLength)
    dataInputStream.readFully(buffer, 0, imageLength)
    val inputStream: InputStream = ByteArrayInputStream(buffer, 0, imageLength)
    val bitmap = this.decodeImage(this.mimeType, inputStream)

    val byteArrayOutputStream = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, this.quality, byteArrayOutputStream)
    val byteArray = byteArrayOutputStream.toByteArray()

    return Base64.encodeToString(byteArray, Base64.NO_WRAP)
  } catch (e: IOException) {
    e.printStackTrace()
  }
  return null
}

@OptIn(ExperimentalStdlibApi::class)
fun SODFile.readASN1Data(): String {
  val a = SODFile::class.java.getDeclaredField("signedData");
  a.isAccessible = true

  val v: SignedData = a.get(this) as SignedData

  val encapsulatedContent =
    v.encapContentInfo.content.toASN1Primitive().encoded!!.toHexString()

  val target = "30"
  val startIndex = encapsulatedContent.indexOf(target)
  return encapsulatedContent.substring(startIndex)
}

data class BacKeyParameters(
  val dateOfBirth: String,
  val dateOfExpiry: String,
  val documentNumber: String,
  val can: String? = null,
)

data class NFCDocumentModel(
  val mrzInfo: MRZInfo? = null,
  val passportImageRaw: String? = null,

  val activeAuthenticationSignature: ByteArray? = null,
  val dg1: ByteArray? = null,
  val dg11: ByteArray? = null,
  val dg15: ByteArray? = null,
  val sod: ByteArray? = null,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (javaClass != other?.javaClass) return false

    other as NFCDocumentModel

    if (mrzInfo != other.mrzInfo) return false
    if (passportImageRaw != other.passportImageRaw) return false
    if (activeAuthenticationSignature != null) {
      if (other.activeAuthenticationSignature == null) return false
      if (!activeAuthenticationSignature.contentEquals(other.activeAuthenticationSignature)) return false
    } else if (other.activeAuthenticationSignature != null) return false
    if (dg1 != null) {
      if (other.dg1 == null) return false
      if (!dg1.contentEquals(other.dg1)) return false
    } else if (other.dg1 != null) return false
    if (dg11 != null) {
      if (other.dg11 == null) return false
      if (!dg11.contentEquals(other.dg11)) return false
    } else if (other.dg11 != null) return false
    if (dg15 != null) {
      if (other.dg15 == null) return false
      if (!dg15.contentEquals(other.dg15)) return false
    } else if (other.dg15 != null) return false
    if (sod != null) {
      if (other.sod == null) return false
      if (!sod.contentEquals(other.sod)) return false
    } else if (other.sod != null) return false

    return true
  }

  override fun hashCode(): Int {
    var result = mrzInfo?.hashCode() ?: 0
    result = 31 * result + (passportImageRaw?.hashCode() ?: 0)
    result = 31 * result + (activeAuthenticationSignature?.contentHashCode() ?: 0)
    result = 31 * result + (dg1?.contentHashCode() ?: 0)
    result = 31 * result + (dg11?.contentHashCode() ?: 0)
    result = 31 * result + (dg15?.contentHashCode() ?: 0)
    result = 31 * result + (sod?.contentHashCode() ?: 0)
    return result
  }
}

class DocumentScanner(
  private val isoDep: IsoDep,
  private val bacKeyParameters: BacKeyParameters,
  private val challenge: ByteArray,
) {
  val bacKey = BACKey(
    bacKeyParameters.documentNumber,
    bacKeyParameters.dateOfBirth,
    bacKeyParameters.dateOfExpiry
  )

  fun scanPassport(
    onAuthenticatingWithPassport: () -> Unit = {},
    onReadingDataGroupProgress: () -> Unit = {},
    onActiveAuthentication: () -> Unit = {},
    onSuccessfulRead: () -> Unit = {},
    onDebugLog: (String) -> Unit = {},
  ): NFCDocumentModel {
    onAuthenticatingWithPassport()
    onDebugLog("=== Starting Passport Scan ===")

    // Open the card service connection with logging wrapper
    val rawCardService = CardService.getInstance(isoDep)
    rawCardService.open()
    val cardService = LoggingCardService(rawCardService, onDebugLog)

    val service = PassportService(
      cardService,
      PassportService.NORMAL_MAX_TRANCEIVE_LENGTH,
      PassportService.DEFAULT_MAX_BLOCKSIZE,
      true,
      false
    )
    service.open()

    // -- PACE -- //
    var paceSucceeded = false
    try {
      android.util.Log.d("DocumentScanner", "=== Trying PACE Authentication ===")
      android.util.Log.d("DocumentScanner", "Reading EF_CARD_ACCESS...")
      val cardAccessFile = CardAccessFile(service.getInputStream(PassportService.EF_CARD_ACCESS))

      val paceKey = PACEKeySpec.createMRZKey(bacKey)

      val paceInfo = cardAccessFile.securityInfos.filterIsInstance<PACEInfo>().first()
      android.util.Log.d("DocumentScanner", "PACE OID: ${paceInfo.objectIdentifier}")
      android.util.Log.d("DocumentScanner", "PACE paramId: ${paceInfo.parameterId}")
      service.doPACE(
        paceKey,
        paceInfo.objectIdentifier,
        PACEInfo.toParameterSpec(paceInfo.parameterId),
        null
      )
      paceSucceeded = true
      android.util.Log.d("DocumentScanner", "=== PACE SUCCEEDED ===")
    } catch (e: Exception) {
      android.util.Log.d("DocumentScanner", "[ERROR] PACE failed: ${e.message}")
      e.printStackTrace()
    }
    service.sendSelectApplet(paceSucceeded)
    if (!paceSucceeded) {
      onDebugLog("=== Trying BAC Authentication ===")
      try {
        service.getInputStream(PassportService.EF_COM).read()
        onDebugLog("Direct access OK")
      } catch (e: Exception) {
        onDebugLog("Direct access failed, trying BAC...")
        e.printStackTrace()
        service.doBAC(bacKey)
        onDebugLog("BAC succeeded")
      }
    }

    onReadingDataGroupProgress()
    // -- DG1 -- //
    onDebugLog("Reading DG1...")
    val dg1File = try {
      val result = DG1File(service.getInputStream(PassportService.EF_DG1))
      onDebugLog("DG1 read OK")
      result
    } catch(e: Exception) {
      onDebugLog("[ERROR] DG1 failed: ${e.message}")
      null
    }
    val mrzInfo = dg1File?.mrzInfo

    // -- SOD -- //
    onDebugLog("Reading SOD...")
    val sodIn1 = service.getInputStream(PassportService.EF_SOD)
    val byteArray = ByteArray(1024 * 1024)
    val byteLen = sodIn1.read(byteArray)
    val sod = cropByteArray(byteArray, byteLen)
    val sodFile = SODFile(service.getInputStream(PassportService.EF_SOD))
    onDebugLog("SOD read OK (${byteLen} bytes)")

    // -- Face Image -- //
    onDebugLog("Reading DG2 (face image)...")
    val dg2In = service.getInputStream(PassportService.EF_DG2)
    val dg2File = DG2File(dg2In)
    onDebugLog("DG2 read OK")

    val faceInfos = dg2File.faceInfos
    val allFaceImageInfos: MutableList<FaceImageInfo> = ArrayList()
    for (faceInfo in faceInfos) {
      allFaceImageInfos.addAll(faceInfo.faceImageInfos)
    }
    val passportImageRaw = if (allFaceImageInfos.isNotEmpty()) {
      val faceImageInfo = allFaceImageInfos.iterator().next()
      faceImageInfo.toBase64Image()
    } else { null }

    // -- DG11 -- //
    onDebugLog("Reading DG11 (additional personal details)...")
    val dg11File = try {
      val dg11In = service.getInputStream(PassportService.EF_DG11)
      val result = DG11File(dg11In)
      onDebugLog("DG11 read OK")
      result
    } catch (e: Exception) {
      onDebugLog("DG11 not available: ${e.message}")
      null
    }

    // -- DG15 -- //
    val dg15File = null
    // onDebugLog("Reading DG15 (public key)...")
    // val dg15File = try {
    //   val dG15File = service.getInputStream(PassportService.EF_DG15)
    //   val result = DG15File(dG15File)
    //   onDebugLog("DG15 read OK")
    //   result
    // } catch (e: Exception) {
    //   onDebugLog("DG15 not available: ${e.message}")
    //   null
    // }

    onActiveAuthentication()
    // -- Active Authentication -- //
    val aaSignature: ByteArray? = null
    // onDebugLog("=== Active Authentication ===")
    // val aaSignature: ByteArray? = try {
    //   onDebugLog("Challenge: ${challenge.joinToString("") { "%02X".format(it) }}")
    //   val response = service.doAA(
    //     dg15File?.publicKey,
    //     sodFile.digestAlgorithm,
    //     sodFile.signerInfoDigestAlgorithm,
    //     challenge
    //   )
    //   onDebugLog("AA succeeded")
    //   response.response
    // } catch (e: Exception) {
    //   onDebugLog("[ERROR] AA failed: ${e.message}")
    //   null
    // }

    onSuccessfulRead()
    return NFCDocumentModel(
      mrzInfo = mrzInfo,
      passportImageRaw = passportImageRaw,

      dg1 = dg1File?.encoded,
      dg11 = dg11File?.encoded,
      dg15 = null,
      sod = sodFile.encoded,
      activeAuthenticationSignature = aaSignature,
    )
  }

  fun scanIDCard(
    onAuthenticatingWithPassport: () -> Unit = {},
    onReadingDataGroupProgress: () -> Unit = {},
    onActiveAuthentication: () -> Unit = {},
    onSuccessfulRead: () -> Unit = {},
    onDebugLog: (String) -> Unit = {},
  ): NFCDocumentModel {
    onAuthenticatingWithPassport()
    // Open the card service connection with logging wrapper
    val rawCardService = CardService.getInstance(isoDep)
    rawCardService.open()
    val loggingCardService = LoggingCardService(rawCardService, onDebugLog)

    val service = PassportService(
      loggingCardService,
      PassportService.NORMAL_MAX_TRANCEIVE_LENGTH,
      PassportService.DEFAULT_MAX_BLOCKSIZE,
      true,
      false
    )
    service.open()

    // -- PACE (for French ID cards) -- //
    var paceSucceeded = false

    if (!bacKeyParameters.can.isNullOrEmpty()) {
      try {
        onDebugLog("=== PACE Authentication Starting ===")

        val canBytes = bacKeyParameters.can!!.toByteArray(Charsets.US_ASCII)

        onDebugLog("Reading EF_CARD_ACCESS...")
        val cardAccessFile = CardAccessFile(service.getInputStream(PassportService.EF_CARD_ACCESS))
        val securityInfoCollection = cardAccessFile.securityInfos
        onDebugLog("Found ${securityInfoCollection.size} security infos")

        val paceKey = PACEKeySpec(canBytes, 0x02.toByte())
        onDebugLog("PACE Key Type: CAN (0x02)")

        for (securityInfo in securityInfoCollection.toList()) {
          if (securityInfo is PACEInfo) {
            onDebugLog("PACE OID: ${securityInfo.objectIdentifier}")
            onDebugLog("PACE paramId: ${securityInfo.parameterId}")
            onDebugLog("Starting PACE handshake...")
            service.doPACE(
              paceKey,
              securityInfo.objectIdentifier,
              PACEInfo.toParameterSpec(securityInfo.parameterId),
              null
            )
            paceSucceeded = true
            onDebugLog("=== PACE SUCCEEDED ===")
          }
        }
      } catch (e: Exception) {
        onDebugLog("[ERROR] PACE failed: ${e.message}")
        e.printStackTrace()
        // Continue to try without PACE or with BAC
      }
    } else {
      // No CAN — try PACE with MRZ key (works for French CNIe)
      try {
        onDebugLog("=== PACE with MRZ key (no CAN) ===")
        val cardAccessFile = CardAccessFile(service.getInputStream(PassportService.EF_CARD_ACCESS))
        val paceInfo = cardAccessFile.securityInfos.filterIsInstance<PACEInfo>().first()
        val paceKey = PACEKeySpec.createMRZKey(bacKey)
        service.doPACE(paceKey, paceInfo.objectIdentifier, PACEInfo.toParameterSpec(paceInfo.parameterId), null)
        paceSucceeded = true
        onDebugLog("=== PACE with MRZ key SUCCEEDED ===")
      } catch (e: Exception) {
        onDebugLog("PACE with MRZ key failed: ${e.message}")
      }
    }

    // If PACE failed or was skipped, try BAC or direct access
    if (!paceSucceeded) {
      onDebugLog("=== Trying without PACE (BAC fallback) ===")
      try {
        service.sendSelectApplet(false)
        // Try to read EF_COM to check if we can access without auth
        try {
          service.getInputStream(PassportService.EF_COM).read()
          onDebugLog("Direct access OK (no auth required)")
        } catch (e: Exception) {
          onDebugLog("Direct access failed, trying BAC...")
          service.doBAC(bacKey)
          onDebugLog("BAC succeeded")
        }
      } catch (e: Exception) {
        onDebugLog("[ERROR] BAC also failed: ${e.message}")
        throw IllegalStateException(
          "Authentication failed for ID card. " +
          "Try providing the CAN (6 digits) from the back of the card. " +
          "Original error: ${e.message}",
          e
        )
      }
    } else {
      service.sendSelectApplet(true)
    }

    onReadingDataGroupProgress()
    // -- DG1 -- //
    onDebugLog( "Reading DG1...")
    val dg1File = try {
      val result = DG1File(service.getInputStream(PassportService.EF_DG1))
      onDebugLog( "DG1 read OK")
      result
    } catch(e: Exception) {
      onDebugLog("[ERROR] DG1 failed: ${e.message}")
      null
    }
    val mrzInfo = dg1File?.mrzInfo

    // -- SOD -- //
    onDebugLog( "Reading SOD...")
    val sodIn1 = service.getInputStream(PassportService.EF_SOD)
    val byteArray = ByteArray(1024 * 1024)
    val byteLen = sodIn1.read(byteArray)
    val sod = cropByteArray(byteArray, byteLen)
    val sodFile = SODFile(service.getInputStream(PassportService.EF_SOD))
    onDebugLog( "SOD read OK, $byteLen bytes")

    // -- Face Image -- //
    onDebugLog( "Reading DG2 (face image)...")
    val dg2In = service.getInputStream(PassportService.EF_DG2)
    val dg2File = DG2File(dg2In)
    onDebugLog( "DG2 read OK, ${dg2File.faceInfos.size} faces found")

    val faceInfos = dg2File.faceInfos
    val allFaceImageInfos: MutableList<FaceImageInfo> = ArrayList()
    for (faceInfo in faceInfos) {
      allFaceImageInfos.addAll(faceInfo.faceImageInfos)
    }
    val passportImageRaw = if (allFaceImageInfos.isNotEmpty()) {
      val faceImageInfo = allFaceImageInfos.iterator().next()
      faceImageInfo.toBase64Image()
    } else { null }

    // -- DG11 -- //
    onDebugLog( "Reading DG11...")
    val dg11File = try {
      val dg11In = service.getInputStream(PassportService.EF_DG11)
      val result = DG11File(dg11In)
      onDebugLog( "DG11 read OK")
      result
    } catch (e: Exception) {
      onDebugLog( "DG11 not available: ${e.message}")
      null
    }

    // French ID cards do NOT have DG15 or Active Authentication.
    // They use Chip Authentication via PACE-CAM instead.
    onDebugLog("Skipping DG15 and Active Authentication (not present on ID cards)")
    val dg15File: DG15File? = null
    val aaSignature: ByteArray? = null
    onActiveAuthentication()

    onDebugLog( "ID Card scan complete!")
    onSuccessfulRead()
    return NFCDocumentModel(
      mrzInfo = mrzInfo,
      passportImageRaw = passportImageRaw,

      dg1 = dg1File?.encoded,
      dg11 = dg11File?.encoded,
      dg15 = dg15File?.encoded,
      sod = sodFile.encoded,
      activeAuthenticationSignature = aaSignature,
    )
  }

  private fun cropByteArray(inputByteArray: ByteArray, endNumber: Int): ByteArray {
    // Make sure endNumber is within bounds
    val endIndex = if (endNumber > inputByteArray.size) inputByteArray.size else endNumber

    // Use copyOfRange to crop the ByteArray
    return inputByteArray.copyOfRange(0, endIndex)
  }

//  private fun convertToPEM(certificate: X509Certificate): String {
//    val stringWriter = StringWriter()
//    JcaPEMWriter(stringWriter).use { pemWriter ->
//      pemWriter.writeObject(certificate)
//    }
//    return stringWriter.toString()
//  }
}
