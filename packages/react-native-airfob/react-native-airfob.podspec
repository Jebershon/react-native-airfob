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

  # The licensed Airfob framework is not in this repository and never will be.
  # Drop an .xcframework into ios/Frameworks/ and it is picked up automatically,
  # along with the AIRFOB_SDK compilation condition that switches RealAirfobSdk
  # on. Nothing to uncomment, and no licence means no source edit either.
  airfob_frameworks = Dir.glob(File.join(__dir__, "ios", "Frameworks", "*.xcframework"))

  unless airfob_frameworks.empty?
    s.vendored_frameworks = airfob_frameworks.map { |f| "ios/Frameworks/#{File.basename(f)}" }
    s.pod_target_xcconfig = { "SWIFT_ACTIVE_COMPILATION_CONDITIONS" => "AIRFOB_SDK" }
  end
end
