import ExpoModulesCore
import rapidsnark

typealias PubSignals = [String]

struct Proof: Codable {
    let piA: [String]
    let piB: [[String]]
    let piC: [String]
    let proofProtocol: String

    enum CodingKeys: String, CodingKey {
        case piA = "pi_a"
        case piB = "pi_b"
        case piC = "pi_c"
        case proofProtocol = "protocol"
    }
}

struct ZkProof: Codable {
    let proof: Proof
    let pubSignals: PubSignals

    enum CodingKeys: String, CodingKey {
        case proof
        case pubSignals = "pub_signals"
    }
}

enum RapidsnarkUtilsError: Error {
    case invalidBase64String
    case zkProofError(String)
}

func base64StringToData(_ base64String: String) -> Data? {
    return Data(base64Encoded: base64String)
}

func createZkProof(proof: String, pubSignals: String) throws -> ZkProof {
    // Convert proof string to Data
    guard let proofData = proof.data(using: .utf8),
          let pubSignalsData = pubSignals.data(using: .utf8) else {
        throw RapidsnarkUtilsError.zkProofError("Failed to convert proof or inputs to Data")
    }
    
    // Log the proofData to verify it
    if let proofString = String(data: proofData, encoding: .utf8) {
        print("Proof Data: \(proofString)")
    }
    
    if let pubSignalsString = String(data: pubSignalsData, encoding: .utf8) {
        print("Inputs Data: \(pubSignalsString)")
    }
    
    // Parse JSON directly from the UTF-8 string
    let proofJson = try JSONDecoder().decode(Proof.self, from: proofData)
    
    let pubSignalsJson = try JSONDecoder().decode(PubSignals.self, from: pubSignalsData)

    let zkProof = ZkProof(proof: proofJson, pubSignals: pubSignalsJson)
    
    return zkProof
}

extension String: Error {}

public class RapidsnarkWrpModule: Module {
  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('RapidsnarkWrp')` in JavaScript.
    Name("RapidsnarkWrp")
      
      AsyncFunction("groth16ProveWithZKeyFilePath") { (wtns: Data, zkeyFilePath: String, proofBufferSize: Int?, publicBufferSize: Int?, errorBufferSize: Int? ) in
          guard let fileUrl = URL(string: zkeyFilePath.replacingOccurrences(of: "file://", with: "")) else {
                throw "Invalid file path"
          }

          let fileExists = FileManager.default.fileExists(atPath: fileUrl.path)
          
          if (!fileExists) {
              throw "Zkey file does not exist"
          }

          do {
              let currentProofBufferSize : Int;
              if let proofBufferSize {
                  currentProofBufferSize = proofBufferSize;
              } else {
                  currentProofBufferSize = rapidsnark.defaultProofBufferSize;
              }
              
              var currentPublicBufferSize : Int;
              if let publicBufferSize {
                  currentPublicBufferSize = publicBufferSize;
              } else {
                  currentPublicBufferSize = try groth16PublicSizeForZkeyFile(zkeyPath: fileUrl.path);
              }

              var currentErrorBufferSize : Int;
              if let errorBufferSize {
                  currentErrorBufferSize = errorBufferSize;
              } else {
                  currentErrorBufferSize = rapidsnark.defaultErrorBufferSize;
              }
              

              let (proof, inputs) = try rapidsnark.groth16ProveWithZKeyFilePath(zkeyPath: fileUrl.path, witness: wtns, proofBufferSize: currentProofBufferSize, publicBufferSize: currentPublicBufferSize, errorBufferSize: currentErrorBufferSize)

              let zkProof = try createZkProof(proof: proof, pubSignals: inputs)

              return try JSONEncoder().encode(zkProof)
          } catch {
              throw error
          }
      }

    // Defines a JavaScript function that always returns a Promise and whose native code
    // is by default dispatched on the different thread than the JavaScript runtime runs on.
      AsyncFunction("groth16Prove") { (wtns: Data, zkey: Data, proofBufferSize: Int?, publicBufferSize: Int?, errorBufferSize: Int?) -> Data in
          do {
              let currentProofBufferSize : Int;
              if let proofBufferSize {
                  currentProofBufferSize = proofBufferSize;
              } else {
                  currentProofBufferSize = rapidsnark.defaultProofBufferSize;
              }
              
              var currentPublicBufferSize : Int;
              if let publicBufferSize {
                  currentPublicBufferSize = publicBufferSize;
              } else {
                  currentPublicBufferSize = try groth16PublicSizeForZkeyBuf(zkey: zkey);
              }

              var currentErrorBufferSize : Int;
              if let errorBufferSize {
                  currentErrorBufferSize = errorBufferSize;
              } else {
                  currentErrorBufferSize = rapidsnark.defaultErrorBufferSize;
              }

              let (proof, inputs) = try rapidsnark.groth16Prove(zkey: zkey, witness: wtns, proofBufferSize: currentProofBufferSize, publicBufferSize: currentPublicBufferSize, errorBufferSize: currentErrorBufferSize)

              let zkProof = try createZkProof(proof: proof, pubSignals: inputs)

              return try JSONEncoder().encode(zkProof)
          } catch {
              throw RapidsnarkUtilsError.zkProofError(error.localizedDescription)
          }
      }
  }
}
