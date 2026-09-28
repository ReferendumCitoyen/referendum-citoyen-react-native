// QA web preview only (QA_WEB=1): react-native-web's exports cannot be
// redefined, so the font-scale cap (utils/font-scale-cap.ts) is a no-op on web.
exports.CAP_BIG = 1.5;
exports.CAP_SMALL = 1.3;
exports.installFontScaleCap = function installFontScaleCap() {};
