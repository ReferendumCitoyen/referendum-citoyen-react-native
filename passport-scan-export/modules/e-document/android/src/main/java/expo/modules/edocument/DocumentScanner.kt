package expo.modules.edocument

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.nfc.tech.IsoDep
import com.gemalto.jp2.JP2Decoder
import net.sf.scuba.smartcards.CardService
import org.bouncycastle.asn1.cms.SignedData
import org.jmrtd.BACKey
import org.jmrtd.PassportService
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
  ): NFCDocumentModel {
    onAuthenticatingWithPassport()
    // Open the card service connection
    val cardService = CardService.getInstance(isoDep)
    cardService.open()
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
      val cardSecurityFile = CardSecurityFile(service.getInputStream(PassportService.EF_CARD_SECURITY))
      val securityInfoCollection = cardSecurityFile.securityInfos

      for (securityInfo in securityInfoCollection) {
        if (securityInfo is PACEInfo) {
          val paceInfo = securityInfo
          service.doPACE(
            bacKey,
            paceInfo.objectIdentifier,
            PACEInfo.toParameterSpec(paceInfo.parameterId),
            null
          )
          paceSucceeded = true
        }
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
    service.sendSelectApplet(paceSucceeded)
    if (!paceSucceeded) {
      try {
        service.getInputStream(PassportService.EF_COM).read()
      } catch (e: Exception) {
        e.printStackTrace()
        service.doBAC(bacKey)
      }
    }

    onReadingDataGroupProgress()
    // -- DG1 -- //
    val dg1File = try { DG1File(service.getInputStream(PassportService.EF_DG1)) } catch(e: Exception) { null }
    val mrzInfo = dg1File?.mrzInfo

    // -- SOD -- //
    val sodIn1 = service.getInputStream(PassportService.EF_SOD)
    val byteArray = ByteArray(1024 * 1024)
    val byteLen = sodIn1.read(byteArray)
    val sod = cropByteArray(byteArray, byteLen)
    val sodFile = SODFile(service.getInputStream(PassportService.EF_SOD))

    // -- Face Image -- //
    val dg2In = service.getInputStream(PassportService.EF_DG2)
    val dg2File = DG2File(dg2In)

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
    val dg11File = try {
      val dg11In = service.getInputStream(PassportService.EF_DG11)
      DG11File(dg11In)
    } catch (e: Exception) { null }

    // -- DG15 -- //
    val dg15File = try {
      val dG15File = service.getInputStream(PassportService.EF_DG15)
      DG15File(dG15File)
    } catch (e: Exception) {
      null
    }

    onActiveAuthentication()
    // -- Active Authentication -- //
    val aaSignature = try {
      val response = service.doAA(
        dg15File?.publicKey,
        sodFile.digestAlgorithm,
        sodFile.signerInfoDigestAlgorithm,
        challenge
      )
      response.response
    } catch (e: Exception) {
      null
    }

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
