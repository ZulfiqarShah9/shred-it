const { app, BrowserWindow, screen, globalShortcut, ipcMain, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

let shredderWindow = null;
let tray = null;
let isVisible = false;
let secureDeleteEnabled = true;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const BIN_ROOT = path.join(app.getPath('userData'), 'ShredderBin');
const BIN_DIR = path.join(BIN_ROOT, 'files');
const META_FILE = path.join(BIN_ROOT, 'bin.json');

async function readBin() {
    try {
        const raw = await fs.readFile(META_FILE, 'utf8');
        const entries = JSON.parse(raw);
        const kept = [];
        for (const entry of entries) {
            try {
                await fs.access(path.join(BIN_DIR, entry.storedName));
                kept.push(entry);
            } catch (_) { /* already gone */ }
        }
        return kept;
    } catch (_) {
        return [];
    }
}

async function writeBin(entries) {
    await fs.mkdir(BIN_ROOT, { recursive: true });
    await fs.mkdir(BIN_DIR, { recursive: true });
    await fs.writeFile(META_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

async function secureDelete(filePath) {
    if (!secureDeleteEnabled) { await fs.unlink(filePath); return; }
    const stats = await fs.stat(filePath);
    for (let pass = 0; pass < 3; pass++) {
        const handle = await fs.open(filePath, 'r+');
        try {
            let written = 0;
            const chunk = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, stats.size)));
            while (written < stats.size) {
                const count = Math.min(chunk.length, stats.size - written);
                if (pass < 2) crypto.randomFillSync(chunk.subarray(0, count));
                else chunk.subarray(0, count).fill(0);
                await handle.write(chunk, 0, count, written);
                written += count;
            }
        } finally {
            await handle.close();
        }
    }
    await fs.unlink(filePath);
}

function createMainWindow() {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    shredderWindow = new BrowserWindow({
        width: 300,
        height: 560,
        x: width - 330,
        y: Math.max(0, (height - 560) / 2),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: true,
        backgroundColor: '#00000000',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            webSecurity: false
        }
    });
    shredderWindow.loadFile(path.join(__dirname, 'paper-shredder-widget.html'));
    const reveal = () => {
        if (app.isQuitting || !shredderWindow || shredderWindow.isDestroyed()) return;
        if (!shredderWindow.isVisible()) shredderWindow.show();
        shredderWindow.focus();
        isVisible = true;
        updateTrayMenu();
    };
    shredderWindow.once('ready-to-show', reveal);
    setTimeout(reveal, 700);
    shredderWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            shredderWindow.hide();
            isVisible = false;
            updateTrayMenu();
        }
    });
    return shredderWindow;
}

function trayIcon() {
    if (process.platform !== 'darwin') {
        try {
            const colored = nativeImage.createFromPath(path.join(__dirname, 'assets', 'shred-it.png'));
            if (!colored.isEmpty()) return colored.resize({ width: 18, height: 18 });
        } catch (_) { /* use fallback */ }
    }
    const template = path.join(__dirname, 'assets', 'tray-icon-template.png');
    try {
        const image = nativeImage.createFromPath(template);
        if (!image.isEmpty()) {
            const sized = image.resize({ width: 18, height: 18 });
            if (sized.setTemplateImage) sized.setTemplateImage(true);
            return sized;
        }
    } catch (_) { /* use fallback */ }
    return nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
        'pUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfBYW4m0CcCoQ5wvkMYM4xwDkG8A8D5BnMOAZB7D' +
        'AOQZzDiGcw4BnGsA5BvMOAZw7gGQewzAOQZzDiGcw4BnGsA5BvMOAZw7gGQewzAOQZzDiGcw4Bn' +
        'GsA5BvMOAZw7gGQewzAOQZzDiGcw4BnGsA5BvMOAZw7gGQewzAOQZzDiGcw4BnGsA5BvMOAZw4A' +
        'N8E+9X0WjQAAAABJRU5ErkJggg=='
    );
}

function updateTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: isVisible ? 'Hide Shred-it' : 'Show Shred-it', accelerator: 'CmdOrCtrl+Shift+S', click: toggleWindow },
        { type: 'separator' },
        { label: 'Shred Files…', accelerator: 'CmdOrCtrl+Shift+X', click: triggerFileSelect },
        { label: 'Restore Files…', click: restoreFiles },
        { label: 'Burn Bin', accelerator: 'CmdOrCtrl+Shift+E', click: burnBin },
        { type: 'separator' },
        { label: 'How it works…', click: () => shredderWindow?.webContents.send('show-info') },
        { label: 'Settings…', click: () => shredderWindow?.webContents.send('show-settings') },
        { type: 'separator' },
        {
            label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]));
}

function showWindow() {
    if (!shredderWindow || shredderWindow.isDestroyed()) {
        createMainWindow();
        return;
    }
    if (!shredderWindow.isVisible()) {
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.workAreaSize;
        shredderWindow.setPosition(Math.round(width - 330), Math.round(Math.max(0, (height - 560) / 2)));
        shredderWindow.show();
    }
    shredderWindow.focus();
    isVisible = true;
    updateTrayMenu();
}

function toggleWindow() {
    if (!shredderWindow) createMainWindow();
    if (isVisible) {
        shredderWindow.hide();
        isVisible = false;
    } else {
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.workAreaSize;
        shredderWindow.setPosition(Math.round(width - 330), Math.round(Math.max(0, (height - 560) / 2)));
        shredderWindow.show();
        shredderWindow.focus();
        isVisible = true;
    }
    updateTrayMenu();
}

async function triggerFileSelect() {
    if (!shredderWindow) createMainWindow();
    if (!isVisible) toggleWindow();
    shredderWindow.webContents.send('trigger-file-select');
}

async function restoreFiles() {
    const entries = await readBin();
    if (!entries.length) return;
    const remaining = [];
    for (const entry of entries) {
        try {
            const source = path.join(BIN_DIR, entry.storedName);
            const destination = entry.originalPath;
            if (!entry.originalPath) throw new Error('missing original path');
            await fs.access(source);
            try {
                await fs.access(destination);
                throw new Error('destination already exists');
            } catch (error) {
                if (error.message === 'destination already exists') throw error;
            }
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.rename(source, destination);
        } catch (error) {
            remaining.push(entry);
        }
    }
    await writeBin(remaining);
}

async function burnBin() {
    const entries = await readBin();
    if (!entries.length) return 0;
    let burned = 0;
    for (const entry of entries) {
        try {
            await secureDelete(path.join(BIN_DIR, entry.storedName));
            burned++;
        } catch (_) { /* leave entry for a later retry */ }
    }
    await writeBin(entries.filter(entry => {
        try { require('fs').accessSync(path.join(BIN_DIR, entry.storedName)); return true; }
        catch (_) { return false; }
    }));
    return burned;
}

ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(shredderWindow, {
        properties: ['openFile', 'multiSelections'],
        title: 'Select files to shred',
        buttonLabel: 'Shred'
    });
    return result.filePaths;
});

ipcMain.handle('shred-files', async (_event, filePaths) => {
    await fs.mkdir(BIN_DIR, { recursive: true });
    const entries = await readBin();
    const results = [];
    for (const filePath of filePaths || []) {
        try {
            const resolved = path.resolve(filePath);
            if (resolved.startsWith(path.resolve(BIN_DIR) + path.sep)) {
                throw new Error('already in the Shredder Bin');
            }
            const stats = await fs.stat(resolved);
            if (!stats.isFile()) throw new Error('folders are not supported');
            const storedName = crypto.randomUUID() + '-' + path.basename(resolved);
            await fs.rename(resolved, path.join(BIN_DIR, storedName));
            entries.push({
                id: crypto.randomUUID(),
                name: path.basename(resolved),
                originalPath: resolved,
                storedName,
                size: stats.size,
                date: new Date().toISOString()
            });
            results.push({ path: resolved, success: true });
        } catch (error) {
            results.push({ path: filePath, success: false, error: error.message });
        }
    }
    await writeBin(entries);
    return results;
});

ipcMain.on('set-secure-delete', (_event, enabled) => { secureDeleteEnabled = !!enabled; });

ipcMain.handle('get-bin', async () => readBin());
ipcMain.handle('restore-files', async () => { await restoreFiles(); return readBin(); });
ipcMain.handle('burn-bin', async () => burnBin());
ipcMain.handle('show-bin-folder', async () => {
    await fs.mkdir(BIN_DIR, { recursive: true });
    require('electron').shell.openPath(BIN_DIR);
});

ipcMain.handle('get-file-icon', async (_event, filePath) => {
    try {
        const icon = await app.getFileIcon(filePath, { size: 'large' });
        return icon && !icon.isEmpty() ? icon.toDataURL() : null;
    } catch (_) { return null; }
});

ipcMain.handle('get-thumbnail', async (_event, filePath) => {
    if (!filePath || process.platform !== 'darwin') return null;
    let tmpDir = null;
    try {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shred-thumb-'));
        await execFileAsync('qlmanage', ['-t', '-s', '512', '-o', tmpDir, filePath], { timeout: 4000 });
        const files = await fs.readdir(tmpDir);
        const png = files.find(file => file.toLowerCase().endsWith('.png'));
        if (!png) return null;
        const data = await fs.readFile(path.join(tmpDir, png));
        return 'data:image/png;base64,' + data.toString('base64');
    } catch (_) {
        return null;
    } finally {
        if (tmpDir) {
            try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        }
    }
});

ipcMain.on('minimize-window', () => {
    shredderWindow?.hide();
    isVisible = false;
    updateTrayMenu();
});
ipcMain.on('close-window', () => {
    shredderWindow?.hide();
    isVisible = false;
    updateTrayMenu();
});
ipcMain.on('show-settings', () => shredderWindow?.webContents.send('show-settings'));
ipcMain.on('show-info', () => shredderWindow?.webContents.send('show-info'));

function registerShortcuts() {
    globalShortcut.register('CommandOrControl+Shift+S', toggleWindow);
    globalShortcut.register('CommandOrControl+Shift+X', triggerFileSelect);
    globalShortcut.register('CommandOrControl+Shift+E', burnBin);
}

app.whenReady().then(() => {
    tray = new Tray(trayIcon());
    tray.setToolTip('Shred-it');
    updateTrayMenu();
    createMainWindow();
    registerShortcuts();
});

app.on('activate', () => {
    showWindow();
});

app.on('second-instance', () => {
    showWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    if (tray) tray.destroy();
});

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    shredderWindow?.webContents.send('shred-file-path', filePath);
});
