require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-airfob"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = package["license"]
  s.authors      = { "Airfob Mobile" => "noreply@example.com" }
  s.homepage     = "https://developers.airfob.com/sdk"
  s.platforms    = { :ios => "13.0" }
  s.source       = { :path => "." }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.0"

  s.dependency "React-Core"

  # P5: the Airfob SDK is distributed privately by MOCA System. Either vendor the
  # framework here or add their private spec repo to the app's Podfile.
  # s.vendored_frameworks = "ios/Frameworks/AirfobSDK.xcframework"
end
