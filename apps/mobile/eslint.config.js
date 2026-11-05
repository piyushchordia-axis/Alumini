// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
// By relative path, so the phone app needs no dependency on @illuminize/config and the lockfile doesn't change.
const noEmojiIcons = require('../../packages/config/eslint/no-emoji-icons.cjs');

module.exports = defineConfig([
  expoConfig,
  noEmojiIcons,
  {
    ignores: ['dist/*'],
  },
]);
