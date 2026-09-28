// QA web preview only (QA_WEB=1): a static box in place
// of the Lottie animation.
const React = require('react');
const { View } = require('react-native');
function LottieView(props) {
  return React.createElement(View, { style: props.style, testID: 'lottie-stub' });
}
module.exports = LottieView;
module.exports.default = LottieView;
