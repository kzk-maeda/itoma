const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const repository = path.resolve(__dirname, '../..');
config.watchFolders = [repository];
config.resolver.nodeModulesPaths = [path.join(repository, 'node_modules')];
module.exports = config;
