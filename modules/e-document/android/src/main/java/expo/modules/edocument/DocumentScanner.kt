package expo.modules.edocument

import android.nfc.tech.IsoDep
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
import org.jmrtd.lds.icao.DG12File
import org.jmrtd.lds.icao.DG14File
import org.jmrtd.lds.icao.DG15File
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.MRZInfo
import android.util.Base64

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

  val activeAuthenticationSignature: ByteArray? = null,
  val dg1: ByteArray? = null,
  val dg11: ByteArray? = null,
  val dg12: ByteArray? = null,
  val dg14: ByteArray? = null,
  val dg15: ByteArray? = null,
  val sod: ByteArray? = null,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (javaClass != other?.javaClass) return false

    other as NFCDocumentModel

    if (mrzInfo != other.mrzInfo) return false
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
    if (dg12 != null) {
      if (other.dg12 == null) return false
      if (!dg12.contentEquals(other.dg12)) return false
    } else if (other.dg12 != null) return false
    if (dg14 != null) {
      if (other.dg14 == null) return false
      if (!dg14.contentEquals(other.dg14)) return false
    } else if (other.dg14 != null) return false
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
    result = 31 * result + (activeAuthenticationSignature?.contentHashCode() ?: 0)
    result = 31 * result + (dg1?.contentHashCode() ?: 0)
    result = 31 * result + (dg11?.contentHashCode() ?: 0)
    result = 31 * result + (dg12?.contentHashCode() ?: 0)
    result = 31 * result + (dg14?.contentHashCode() ?: 0)
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

    // -- Face Image (DG2): NOT READ -- //
    // DG2 (the holder's facial image) serves no purpose in the eligibility
    // flow — the proof uses DG1 only — so we don't read it, for data
    // minimisation (DPIA R5 #5). There is no facial-image field on the model
    // either: the whole field was removed from the type chain, so nothing
    // downstream can carry a face image even if DG2 were read by mistake.
    // Nor is there any code left that could turn one into a picture: the
    // JPEG2000/WSQ decode helpers this module used to carry are deleted too.

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

    // -- DG12 (issuing authority, date of issue) -- //
    onDebugLog("Reading DG12 (issuing authority)...")
    val dg12File = try {
      val dg12In = service.getInputStream(PassportService.EF_DG12)
      val result = DG12File(dg12In)
      onDebugLog("DG12 read OK")
      result
    } catch (e: Exception) {
      onDebugLog("DG12 not available: ${e.message}")
      null
    }

    // -- DG14 (chip authentication info) -- //
    onDebugLog("Reading DG14 (chip auth info)...")
    val dg14File = try {
      val dg14In = service.getInputStream(PassportService.EF_DG14)
      val result = DG14File(dg14In)
      onDebugLog("DG14 read OK")
      result
    } catch (e: Exception) {
      onDebugLog("DG14 not available: ${e.message}")
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

      dg1 = dg1File?.encoded,
      dg11 = dg11File?.encoded,
      dg12 = dg12File?.encoded,
      dg14 = dg14File?.encoded,
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

        // A CNIe announces two PACEInfos (Generic Mapping + Integrated Mapping,
        // same brainpoolP256r1 / AES-256 parameters). Prefer GM — the mapping a
        // real CNIe is read with — and stop after the first success: a second
        // doPACE over the freshly established secure channel would tear it
        // down. The parameterId is passed through so JMRTD emits tag 0x84 in
        // MSE:Set AT (TR-03110-3 B.1: required when the card announces several
        // sets of domain parameters). CAN path only; the MRZ path is untouched.
        // Proven on a real card.
        val paceInfos = securityInfoCollection
          .filterIsInstance<PACEInfo>()
          .sortedBy { info ->
            val mapping = runCatching { PACEInfo.toMappingType(info.objectIdentifier) }.getOrNull()
            if (mapping == PACEInfo.MappingType.GM) 0 else 1
          }
        for (paceInfo in paceInfos) {
          onDebugLog("PACE OID: ${paceInfo.objectIdentifier}")
          onDebugLog("PACE paramId: ${paceInfo.parameterId}")
          onDebugLog("Starting PACE handshake (CAN, 0x84 parameterId sent)...")
          service.doPACE(
            paceKey,
            paceInfo.objectIdentifier,
            PACEInfo.toParameterSpec(paceInfo.parameterId),
            paceInfo.parameterId
          )
          paceSucceeded = true
          onDebugLog("=== PACE SUCCEEDED ===")
          break
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

    // -- Face Image (DG2): NOT READ -- //
    // DG2 (the holder's facial image) serves no purpose in the eligibility
    // flow — the proof uses DG1 only — so we don't read it, for data
    // minimisation (DPIA R5 #5). There is no facial-image field on the model
    // either: the whole field was removed from the type chain, so nothing
    // downstream can carry a face image even if DG2 were read by mistake.
    // Nor is there any code left that could turn one into a picture: the
    // JPEG2000/WSQ decode helpers this module used to carry are deleted too.

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
