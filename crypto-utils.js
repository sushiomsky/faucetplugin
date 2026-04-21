// A simple AES-GCM encryption utility for browser extensions
// Secures plaintext passwords in chrome.storage.local
const __FP_Crypto = {
  async getKey() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['_extension_key'], async (result) => {
        if (result._extension_key) {
          const keyRaw = new Uint8Array(result._extension_key);
          const key = await crypto.subtle.importKey(
            'raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
          );
          resolve(key);
        } else {
          const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
          );
          const exported = await crypto.subtle.exportKey('raw', key);
          chrome.storage.local.set({ _extension_key: Array.from(new Uint8Array(exported)) }, () => {
            resolve(key);
          });
        }
      });
    });
  },

  async encrypt(text) {
    if (!text || typeof text !== 'string') return text;
    // Basic heuristics to avoid double-encrypting
    if (text.startsWith('ENC:')) return text;

    try {
      const key = await this.getKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(text);
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      return 'ENC:' + btoa(String.fromCharCode(...combined));
    } catch(e) {
      console.warn("Encryption failed", e);
      return text;
    }
  },

  async decrypt(cipherText) {
    if (!cipherText || typeof cipherText !== 'string' || !cipherText.startsWith('ENC:')) {
      return cipherText;
    }
    
    try {
      const b64 = cipherText.substring(4); // Remove 'ENC:'
      const combined = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      const key = await this.getKey();
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
      return new TextDecoder().decode(decrypted);
    } catch(e) {
      console.warn("Decryption failed", e);
      return cipherText;
    }
  }
};
