Pod::Spec.new do |s|
  s.name = 'ItomaScreenTime'
  s.version = '0.1.0'
  s.summary = 'ITOMA shared Screen Time adapters, without Expo or private reasons'
  s.homepage = 'https://github.com/kzk-maeda/itoma'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'ITOMA contributors'
  s.source = { :git => 'https://github.com/kzk-maeda/itoma.git', :tag => s.version.to_s }
  s.platform = :ios, '16.0'
  s.swift_version = '6.0'
  s.static_framework = true
  s.source_files = 'Sources/ItomaScreenTime/**/*.swift'
  s.dependency 'ItomaCore'
  s.dependency 'ItomaStorage'
  s.dependency 'ItomaControl'
  s.frameworks = 'DeviceActivity', 'FamilyControls', 'ManagedSettings'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'APPLICATION_EXTENSION_API_ONLY' => 'YES' }
end
