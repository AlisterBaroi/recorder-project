// const { app, BrowserWindow } = require('electron');
// const { ipcMain, BrowserWindow, desktopCapturer } = require('electron');
const { app, ipcMain, BrowserWindow, desktopCapturer, screen } = require('electron');
const remoteMain = require('@electron/remote/main');   // NEW
remoteMain.initialize();
const path = require('path');


/* Let the renderer call require('electron') */
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

function createWindow() {
    // Get the display where the cursor is (works with multi-monitor setups)
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);

    // Your fixed window size
    // const WIN_W = 600;
    const WIN_W = 576;
    const WIN_H = 58;

    // Calculate centred X, stick to Y = 0 (top edge)
    const x = Math.round(display.workArea.x + (display.workArea.width - WIN_W) / 2);
    // const y = display.workArea.y + 10;   // or +10 if you want a small gap
    const y = display.workArea.y + (display.workArea.height - WIN_H - 30);   // or +10 if you want a small gap

    const win = new BrowserWindow({
        // width: 596,
        // height: 54,
        x, y,                         // ⬅ position
        width: WIN_W,
        height: WIN_H,
        resizable: false,
        transparent: true,                // window itself is see-through
        backgroundColor: '#00000000',     // macOS + Windows want an explicit 0-alpha colour
        frame: false,               // ← no native title-bar / buttons
        titleBarStyle: 'hidden',   // macOS: remove traffic-lights
        webPreferences: {
            nodeIntegration: true,      // ⚠️  Node in renderer
            contextIsolation: false,     // ⚠️  single JS world
            enableRemoteModule: true
        }
    });

    win.removeMenu();
    win.setAlwaysOnTop(true); // always on top, even over fullscreen apps
    win.loadFile('index.html');
    remoteMain.enable(win.webContents);

    // win.webContents.openDevTools({ mode: 'detach' });   // auto-open DevTools
    // if (!app.isPackaged) {                              // only in dev
    //     win.webContents.openDevTools({ mode: 'detach' });
    // }
}


// new picker window
ipcMain.handle('pick-screen', async () => {
    /* gather screens (monitors only) */
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });

    return new Promise((resolve) => {
        const picker = new BrowserWindow({
            width: sources.length * 340,
            height: 260,
            resizable: false,
            modal: true,
            parent: BrowserWindow.getFocusedWindow(),
            webPreferences: { nodeIntegration: true, contextIsolation: false },
            center: true
        });

        picker.setMenuBarVisibility(false);
        picker.loadFile('picker.html');

        /* pass list once the page is ready */
        picker.webContents.once('did-finish-load', () => {
            picker.webContents.send('screens', sources.map(s => ({
                id: s.id,
                name: s.name,
                dataURL: s.thumbnail.toDataURL()
            })));
        });

        /* receive selection */
        ipcMain.once('screen-chosen', (event, id) => {
            resolve(id);
            picker.close();
        });
    });
});
// end here

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });



