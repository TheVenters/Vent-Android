const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add web-specific platform extensions
config.resolver.platforms = ['web', 'ios', 'android'];

module.exports = config;

