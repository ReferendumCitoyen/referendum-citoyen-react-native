Pod::Spec.new do |s|
  s.name           = 'Witnesscalculator'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '13.4', :tvos => '13.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.static_framework = true
  s.vendored_frameworks = 'libs/RmoCalcs.xcframework'

  # queryIdentity ships as a separate flat `.a` (arm64 only, same artefact
  # rarime-ios-app ships under its Frameworks/). It is NOT inside
  # RmoCalcs.xcframework because xcframeworks expect one binary per slice.
  # The header in libs/witnesscalc_queryIdentity.h is auto-picked-up by the
  # source_files glob below, exposing `witnesscalc_queryIdentity(...)` to
  # Swift through the pod's auto-generated module map.
  s.vendored_libraries = 'libs/libwitnesscalc_queryIdentity.a'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
