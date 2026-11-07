Pod::Spec.new do |s|
  s.name = 'ItomaNative'
  s.version = '0.1.0'
  s.summary = 'ITOMA local Expo bridge'
  s.homepage = 'https://github.com/kzk-maeda/itoma'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'ITOMA contributors'
  s.source = { :git => 'https://github.com/kzk-maeda/itoma.git', :tag => s.version.to_s }
  s.platform = :ios, '15.1'
  s.swift_version = '6.0'
  s.static_framework = true
  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.dependency 'ItomaCore'
  s.dependency 'ItomaStorage'
  s.dependency 'ItomaControl'
  s.dependency 'ItomaHistory'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
