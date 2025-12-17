//
//  DocumentScanner.swift
//  EDocument
//
//  Created by Lukachi Sama on 27.08.2024.
//

import Foundation
import UIKit
import NFCPassportReader

struct BacKeyParameters: Codable {
    var documentNumber: String
    var dateOfBirth: String
    var dateOfExpiry: String
}

struct PersonDetails : Codable {
    var firstName: String
    var lastName: String
    var gender: String
    var passportImageRaw: String?
    var issuingAuthority: String
    var documentNumber: String
    var documentExpiryDate: String
    var dateOfBirth: String
    var nationality: String
}

struct Passport: Codable {
    var personDetails: PersonDetails
    let dg1: String // base64
    let dg15: String // base64
    let sod: String // base64
    let signature: String // base64
    let dg11: String? // base64

    static func fromNFCPassportModel(_ model: NFCPassportModel) -> Passport {
        let dg1 = model.getDataGroup(.DG1)?.data ?? []
        let dg11 = model.getDataGroup(.DG11)?.data ?? []
        let dg15 = model.getDataGroup(.DG15)?.data ?? []
        let sod = model.getDataGroup(.SOD)?.data ?? []
        
        // HACK: For some reason Georgian passports have the first name and last name
        // joined together in the last name field
        let nameParts = model.lastName.components(separatedBy: " ")
        let hasJoinedName = model.firstName.isEmpty && nameParts.count == 2
        
        let personDetails = PersonDetails(
            firstName: hasJoinedName ? nameParts[0] : model.firstName,
            lastName: hasJoinedName ? nameParts[1] : model.lastName,
            gender: model.gender,
            passportImageRaw: model.passportImage?
                .pngData()?
                .base64EncodedString(options: .endLineWithLineFeed),
            issuingAuthority: model.issuingAuthority,
            documentNumber: model.documentNumber,
            documentExpiryDate: model.documentExpiryDate,
            dateOfBirth: model.dateOfBirth,
            nationality: model.nationality
        )

        return Passport(
            personDetails: personDetails,
            dg1: Data(dg1).base64EncodedString(),
            dg15: Data(dg15).base64EncodedString(),
            sod: Data(sod).base64EncodedString(),
            signature: Data(model.activeAuthenticationSignature).base64EncodedString(),
            dg11: Data(dg11).base64EncodedString()
        )
    }
    
    func serialize() throws -> Data {
        let encoder = JSONEncoder()
        return try encoder.encode(self)
    }
}

class PassportUtils {
    static func getMRZKey(passportNumber: String, dateOfBirth: String, dateOfExpiry: String) -> String {
        let pptNr = pad(passportNumber, fieldLength: 9)
        let dob = pad(dateOfBirth, fieldLength: 6)
        let exp = pad(dateOfExpiry, fieldLength: 6)
        
        let passportNrChksum = calcCheckSum(pptNr)
        let dateOfBirthChksum = calcCheckSum(dob)
        let expiryDateChksum = calcCheckSum(exp)
        
        let mrzKey = "\(pptNr)\(passportNrChksum)\(dob)\(dateOfBirthChksum)\(exp)\(expiryDateChksum)"
        
        return mrzKey
    }
    
    private static func pad(_ value: String, fieldLength: Int) -> String {
        let paddedValue = (value + String(repeating: "<", count: fieldLength)).prefix(fieldLength)
        return String(paddedValue)
    }
    
    private static func calcCheckSum(_ checkString: String) -> Int {
        var sum = 0
        var m = 0
        let multipliers: [Int] = [7, 3, 1]
        for c in checkString {
            guard let lookup = checkSumCoderDict["\(c)"],
                  let number = Int(lookup) else { return 0 }
            let product = number * multipliers[m]
            sum += product
            m = (m + 1) % 3
        }
        
        return sum % 10
    }
}

private let checkSumCoderDict = [
    "0": "0",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
    "<": "0",
    " ": "0",
    "A": "10",
    "B": "11",
    "C": "12",
    "D": "13",
    "E": "14",
    "F": "15",
    "G": "16",
    "H": "17",
    "I": "18",
    "J": "19",
    "K": "20",
    "L": "21",
    "M": "22",
    "N": "23",
    "O": "24",
    "P": "25",
    "Q": "26",
    "R": "27",
    "S": "28",
    "T": "29",
    "U": "30",
    "V": "31",
    "W": "32",
    "X": "33",
    "Y": "34",
    "Z": "35"
]

extension String: Error {}
