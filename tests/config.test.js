// tests/config.test.js
// Automated Sanity Suite for FaucetPick Configuration
// Catches common historical failure points before release.

describe('Extension Configuration Sanity', () => {

  it('manifest.json data is loaded', () => {
    assert(window.__MANIFEST__, 'window.__MANIFEST__ must be defined (run build.sh first)');
    assertEqual(typeof window.__MANIFEST__, 'object', 'Manifest data must be an object');
  });

  it('version.json data is loaded', () => {
    assert(window.__VERSION__, 'window.__VERSION__ must be defined (run build.sh first)');
    assertEqual(typeof window.__VERSION__, 'object', 'Version data must be an object');
  });

  it('version.json matches manifest.json version', () => {
    assertEqual(window.__MANIFEST__.version, window.__VERSION__.version, 'Manifest and Version file must match exactly');
  });

  it('background service worker is NOT a module (for importScripts)', () => {
    const bg = window.__MANIFEST__.background || {};
    assertEqual(bg.type, undefined, 'Background service_worker must NOT have type: module when using importScripts');
  });

  it('manifest icons use standard underscored naming', () => {
    const icons = window.__MANIFEST__.icons || {};
    const actionIcons = (window.__MANIFEST__.action && window.__MANIFEST__.action.default_icon) || {};
    
    const allPaths = [...Object.values(icons), ...Object.values(actionIcons)];
    for (const path of allPaths) {
      assert(path.includes('_'), `Icon path "${path}" must include an underscore (e.g. icon_16.png) to match project standards`);
    }
  });

  it('content_scripts js files are present in right order', () => {
      const cs = window.__MANIFEST__.content_scripts[0];
      assertEqual(cs.js[0], 'constants.js', 'constants.js must be first for shared functions');
      assertEqual(cs.js[1], 'selectors.js', 'selectors.js must be second');
      assertEqual(cs.js[2], 'faucet.js', 'faucet.js must be third');
  });

});
