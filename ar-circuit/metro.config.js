// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// TF.js weight shards (*.bin) must be bundled as assets.
config.resolver.assetExts.push('bin');

module.exports = config;
