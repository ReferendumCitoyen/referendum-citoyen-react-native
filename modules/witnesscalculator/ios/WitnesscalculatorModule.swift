import ExpoModulesCore

public class WitnesscalculatorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("Witnesscalculator")
        
        AsyncFunction("calcWtnsRegisterIdentityUniversalRSA4096") { (dat: Data, inputs: Data) -> Data in
            do {
                let result = try WtnsUtils.calcWtnsRegisterIdentityUniversalRSA4096(dat, inputs)

                return result
            } catch {
                // DEBUG only: the error is rethrown to JS, where the redactor
                // sees it, so a release binary has no reason to write it to
                // the device log unfiltered as well.
                #if DEBUG
                print(error)
                #endif
                throw error
            }
        }
        
        AsyncFunction("calcWtnsRegisterIdentityUniversalRSA2048") { (dat: Data, inputs: Data) -> Data in
            let result = try WtnsUtils.calcWtnsRegisterIdentityUniversalRSA2048(dat, inputs)

            return result
        }
        
        AsyncFunction("calcWtnsAuth") { (dat: Data, inputs: Data) -> Data in
            let result = try WtnsUtils.calcWtnsAuth(dat, inputs)
            return result
        }

        AsyncFunction("calcWtnsQueryIdentity") { (dat: Data, inputs: Data) -> Data in
            let result = try WtnsUtils.calcWtnsQueryIdentity(dat, inputs)
            return result
        }
    }
}
