/**
 * The version a controller reports in the agent handshake.
 *
 * It is a source constant rather than a runtime lookup so the plugin bundle
 * keeps working when it is installed without the package root. The release
 * test compares it with package.json and the extension manifest.
 */
export const FLEET_VERSION = '0.11.2';
