// File purpose: Metro bundler configuration that lets Expo serve and compile the React Native app.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add web-specific platform extensions
config.resolver.platforms = ['web', 'ios', 'android'];

module.exports = config;

