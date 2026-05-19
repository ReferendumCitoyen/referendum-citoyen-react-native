import ExpoModulesCore

public class WitnesscalculatorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("Witnesscalculator")
        
        AsyncFunction("calcWtnsRegisterIdentityUniversalRSA4096") { (dat: Data, inputs: Data) -> Data in
            do {
                let result = try WtnsUtils.calcWtnsRegisterIdentityUniversalRSA4096(dat, inputs)

                return result
            } catch {
                print(error)
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
    }
}
