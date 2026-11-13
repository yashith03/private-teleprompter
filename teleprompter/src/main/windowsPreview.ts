import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Configure Windows Desktop Window Manager (DWM) attributes on the BrowserWindow HWND:
 * 1. DWMWA_DISALLOW_PEEK (11): Disallows full-screen live Peek preview when hovering over the taskbar thumbnail.
 * 2. DWMWA_EXCLUDED_FROM_PEEK (12): Excludes this window from Peek when other windows are peeked.
 * 3. DWMWA_FORCE_ICONIC_REPRESENTATION (7): Tells DWM to request or accept an iconic bitmap instead of live window content.
 * 4. DWMWA_HAS_ICONIC_BITMAP (10): Signals that the window provides iconic representation.
 * 5. Sets the iconic thumbnail and live preview bitmap to the static app logo so no speech text is shown in hover previews.
 */
export function applyWindowsTaskbarPreviewProtection(win: BrowserWindow): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return;

  try {
    const handle = win.getNativeWindowHandle();
    // HWND on Windows x64 is a 64-bit integer stored little-endian
    const hwnd = handle.length >= 8 ? handle.readBigInt64LE(0).toString() : handle.readInt32LE(0).toString();

    // Look for dwmHelper.exe and logo.png in the app directory or unpack directory
    const candidates = [
      path.join(__dirname, 'windows'),
      path.join(__dirname, '..', 'src', 'main', 'windows'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist', 'main', 'windows'),
      path.join(process.resourcesPath || '', 'app', 'dist', 'main', 'windows'),
      path.join(__dirname)
    ];

    let helperExe: string | null = null;
    let logoPng: string | null = null;

    for (const dir of candidates) {
      const exe = path.join(dir, 'dwmHelper.exe');
      const logo = path.join(dir, 'logo.png');
      if (!helperExe && fs.existsSync(exe)) helperExe = exe;
      if (!logoPng && fs.existsSync(logo)) logoPng = logo;
    }

    if (helperExe) {
      const args = [hwnd];
      if (logoPng) args.push(logoPng);
      const child = spawn(helperExe, args, {
        windowsHide: true,
        stdio: 'ignore',
        detached: true
      });
      child.unref();
    }
  } catch (err) {
    // Non-fatal if DWM configuration cannot be run
  }
}
