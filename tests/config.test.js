// tests/config.test.js
// Automated Sanity Suite for FaucetPick Configuration
// Catches common historical failure points before release.

describe('Extension Configuration Sanity', () => {

  itAsync('manifest.json is valid JSON', async () => {
    try {
      const resp = await fetch('../manifest.json');
      const text = await resp.text();
      JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse manifest.json: ${e.message}`);
    }
  });

  itAsync('version.json matches manifest.json version', async () => {
    const mResp = await fetch('../manifest.json');
    const manifest = await mResp.json();
    
    const vResp = await fetch('../version.json');
    const version = await vResp.json();
    
    assertEqual(manifest.version, version.version, 'Manifest and Version file must match exactly');
  });

  itAsync('background service worker is NOT a module (for importScripts)', async () => {
    const resp = await fetch('../manifest.json');
    const manifest = await resp.json();
    
    const bg = manifest.background || {};
    assertEqual(bg.type, undefined, 'Background service_worker must NOT have type: module when using importScripts');
  });

  itAsync('manifest icons use standard underscored naming', async () => {
    const resp = await fetch('../manifest.json');
    const manifest = await resp.json();
    
    const icons = manifest.icons || {};
    const actionIcons = (manifest.action && manifest.action.default_icon) || {};
    
    const allPaths = [...Object.values(icons), ...Object.values(actionIcons)];
    for (const path of allPaths) {
      assert(path.includes('_'), `Icon path "${path}" must include an underscore (e.g. icon_16.png) to match project standards`);
    }
  });

  itAsync('content_scripts js files are present in right order', async () => {
      const resp = await fetch('../manifest.json');
      const manifest = await resp.json();
      
      const cs = manifest.content_scripts[0];
      assertEqual(cs.js[0], 'constants.js', 'constants.js must be first for shared functions');
      assertEqual(cs.js[1], 'selectors.js', 'selectors.js must be second');
      assertEqual(cs.js[2], 'faucet.js', 'faucet.js must be third');
  });

});
