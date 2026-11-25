const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFiles: () => ipcRenderer.invoke('select-files'),
    shredFiles: (paths) => ipcRenderer.invoke('shred-files', paths),
    getBin: () => ipcRenderer.invoke('get-bin'),
    restoreFiles: () => ipcRenderer.invoke('restore-files'),
    burnBin: () => ipcRenderer.invoke('burn-bin'),
    setSecureDelete: (enabled) => ipcRenderer.send('set-secure-delete', enabled),
    showBinFolder: () => ipcRenderer.invoke('show-bin-folder'),
    getThumbnail: (filePath) => ipcRenderer.invoke('get-thumbnail', filePath),
    getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    onTriggerFileSelect: (callback) => ipcRenderer.on('trigger-file-select', callback),
    onEmptyBin: (callback) => ipcRenderer.on('empty-bin', callback),
    onShowSettings: (callback) => ipcRenderer.on('show-settings', callback),
    onShowInfo: (callback) => ipcRenderer.on('show-info', callback),
    onShredFilePath: (callback) => ipcRenderer.on('shred-file-path', (event, filePath) => callback(filePath))
});
