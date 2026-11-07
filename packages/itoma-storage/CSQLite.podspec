Pod::Spec.new do |s|
  s.name = 'CSQLite'
  s.version = '0.1.0'
  s.summary = 'Apple system SQLite headers for ITOMA local pods'
  s.homepage = 'https://github.com/kzk-maeda/itoma'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'ITOMA contributors'
  s.source = { :git => 'https://github.com/kzk-maeda/itoma.git', :tag => s.version.to_s }
  s.platform = :ios, '15.1'
  s.source_files = 'Sources/CSQLite/shim.h'
  s.public_header_files = 'Sources/CSQLite/shim.h'
  s.libraries = 'sqlite3'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
