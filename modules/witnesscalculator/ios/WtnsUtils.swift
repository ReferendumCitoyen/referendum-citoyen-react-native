//
//  WtnsUtils.swift
//  Witnesscalculator
//
//  Created by Lukachi Sama on 18.08.2024.
//

import Foundation

extension String: Error {}

extension String: LocalizedError {
    public var errorDescription: String? {
        return self
    }
}

class WtnsUtils {
    static let ERROR_SIZE = UInt(256);
    static let WITNESS_SIZE = UInt(100 * 1024 * 1024)
    static let PROOF_SIZE = UInt(4 * 1024 * 1024)
    static let PUB_SIGNALS_SIZE = UInt(4 * 1024 * 1024)
    
    static public func calcWtnsRegisterIdentityUniversalRSA4096(
            _ descriptionFileData: Data,
            _ privateInputsJson: Data
    ) throws -> Data {
        let wtnsSize = UnsafeMutablePointer<UInt>.allocate(capacity: Int(1));
        wtnsSize.initialize(to: WITNESS_SIZE)
        let wtnsBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(WITNESS_SIZE))
        let errorBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(ERROR_SIZE))
        
        let result = witnesscalc_registerIdentityUniversalRSA4096(
            (descriptionFileData as NSData).bytes, UInt(descriptionFileData.count),
            (privateInputsJson as NSData).bytes, UInt(privateInputsJson.count),
            wtnsBuffer, wtnsSize,
            errorBuffer, ERROR_SIZE
        )
        
        try handleWitnessError(result, errorBuffer, wtnsSize)
        
        return Data(bytes: wtnsBuffer, count: Int(wtnsSize.pointee))
    }
    
    static public func calcWtnsRegisterIdentityUniversalRSA2048(
            _ descriptionFileData: Data,
            _ privateInputsJson: Data
    ) throws -> Data {
        let wtnsSize = UnsafeMutablePointer<UInt>.allocate(capacity: Int(1));
        wtnsSize.initialize(to: WITNESS_SIZE)
        let wtnsBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(WITNESS_SIZE))
        let errorBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(ERROR_SIZE))
        
        let result = witnesscalc_registerIdentityUniversalRSA2048(
            (descriptionFileData as NSData).bytes, UInt(descriptionFileData.count),
            (privateInputsJson as NSData).bytes, UInt(privateInputsJson.count),
            wtnsBuffer, wtnsSize,
            errorBuffer, ERROR_SIZE
        )
        
        try handleWitnessError(result, errorBuffer, wtnsSize)
        
        return Data(bytes: wtnsBuffer, count: Int(wtnsSize.pointee))
    }
    
    static public func calcWtnsAuth(_ descriptionFileData: Data, _ privateInputsJson: Data) throws -> Data {
        return try _calcWtnsAuth(descriptionFileData, privateInputsJson)
    }
    
    static private func _calcWtnsAuth(
        _ descriptionFileData: Data,
        _ privateInputsJson: Data
    ) throws -> Data {
        let wtnsSize = UnsafeMutablePointer<UInt>.allocate(capacity: Int(1));
        wtnsSize.initialize(to: WITNESS_SIZE)
        let wtnsBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(WITNESS_SIZE))
        let errorBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(ERROR_SIZE))
        
        let result = witnesscalc_auth(
            (descriptionFileData as NSData).bytes, UInt(descriptionFileData.count),
            (privateInputsJson as NSData).bytes, UInt(privateInputsJson.count),
            wtnsBuffer, wtnsSize,
            errorBuffer, ERROR_SIZE
        )
        
        try handleWitnessError(result, errorBuffer, wtnsSize)
        
        return Data(bytes: wtnsBuffer, count: Int(wtnsSize.pointee))
    }
    
    private static func handleWitnessError(
        _ result: Int32,
        _ errorBuffer: UnsafeMutablePointer<UInt8>,
        _ wtnsSize: UnsafeMutablePointer<UInt>
    ) throws {
        if result == WITNESSCALC_ERROR {
            throw String(bytes: Data(bytes: errorBuffer, count: Int(ERROR_SIZE)), encoding: .utf8)!
                .replacingOccurrences(of: "\0", with: "")
        }
        
        if result == WITNESSCALC_ERROR_SHORT_BUFFER {
            throw String("Buffer to short, should be at least: \(wtnsSize.pointee)")
        }
    }
}
