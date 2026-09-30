import type { ConfigPlugin } from '@expo/config-plugins';
import type { PluginConfigType } from 'expo-build-properties/build/pluginConfig';
export declare const withNfc: ConfigPlugin<PluginConfigType & {
    includeNdefEntitlement?: boolean;
    nfcPermission?: boolean;
    selectIdentifiers?: string[];
    systemCodes?: string[];
}>;
export default withNfc;
