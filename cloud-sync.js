// ── cloud-sync.js ─────────────────────────────────────────────────────────────

class GoogleDriveSync {
  constructor() {
    this.FILE_NAME = "faucetpick_settings.json";
    this.CLIENT_ID = ""; // Will be read from manifest via identity
  }

  async getAuthToken(interactive = true) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
  }

  async removeCachedToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, resolve);
    });
  }

  async fetchWithToken(url, options = {}, interactive = true) {
    let token = await this.getAuthToken(interactive);
    try {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`
      };
      let response = await fetch(url, options);
      
      // If unauthorized, token might be expired
      if (response.status === 401 && interactive) {
        await this.removeCachedToken(token);
        token = await this.getAuthToken(true);
        options.headers.Authorization = `Bearer ${token}`;
        response = await fetch(url, options);
      }
      
      return response;
    } catch (err) {
      console.error("[GDrive] Fetch Error:", err);
      throw err;
    }
  }

  async findSettingsFile() {
    const query = encodeURIComponent(`name = '${this.FILE_NAME}' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)`;
    
    const response = await this.fetchWithToken(url);
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  async uploadSettings(settings) {
    const existingFile = await this.findSettingsFile();
    const metadata = {
      name: this.FILE_NAME,
      mimeType: "application/json"
    };

    // Add local timestamp to settings for conflict resolution
    const dataToSync = {
      ...settings,
      _syncTimestamp: Date.now(),
      _syncSource: "extension"
    };

    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(dataToSync) +
      close_delim;

    let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
    let method = "POST";

    if (existingFile) {
      url = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart&fields=id`;
      method = "PATCH";
    }

    const response = await this.fetchWithToken(url, {
      method: method,
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GDrive Upload Failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  async downloadSettings() {
    const existingFile = await this.findSettingsFile();
    if (!existingFile) return null;

    const url = `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`;
    const response = await this.fetchWithToken(url);
    
    if (!response.ok) {
      throw new Error(`GDrive Download Failed: ${response.status}`);
    }

    const remoteSettings = await response.json();
    remoteSettings._remoteModifiedTime = existingFile.modifiedTime;
    return remoteSettings;
  }
}

// Export for use in background (service worker) and popup (window)
if (typeof module !== 'undefined') {
  module.exports = GoogleDriveSync;
} else if (typeof window !== 'undefined') {
  window.GoogleDriveSync = new GoogleDriveSync();
} else if (typeof self !== 'undefined') {
  self.GoogleDriveSync = new GoogleDriveSync();
}
