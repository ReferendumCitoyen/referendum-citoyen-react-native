package expo.modules.edocument

import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.CommandAPDU
import net.sf.scuba.smartcards.ResponseAPDU

/**
 * A CardService wrapper that logs all APDU commands and responses.
 * This is useful for debugging NFC communication, especially PACE authentication.
 */
class LoggingCardService(
    private val delegate: CardService,
    private val onLog: (String) -> Unit
) : CardService() {

    override fun transmit(commandAPDU: CommandAPDU): ResponseAPDU {
        // Log the command being sent
        val cmdHex = commandAPDU.bytes.toHexString()
        onLog("[TX] $cmdHex")

        // Send to the actual card
        val response = delegate.transmit(commandAPDU)

        // Log the response received
        val respHex = response.bytes.toHexString()
        val sw = String.format("%04X", response.sw)
        onLog("[RX] $respHex (SW: $sw)")

        return response
    }

    override fun open() {
        onLog("[NFC] Opening connection...")
        delegate.open()
    }

    override fun close() {
        onLog("[NFC] Closing connection...")
        delegate.close()
    }

    override fun isOpen(): Boolean = delegate.isOpen

    override fun getATR(): ByteArray {
        val atr = delegate.atr
        onLog("[NFC] ATR: ${atr.toHexString()}")
        return atr
    }

    override fun isConnectionLost(e: Exception?): Boolean {
        return delegate.isConnectionLost(e)
    }

    private fun ByteArray.toHexString(): String =
        joinToString("") { "%02X".format(it) }
}
