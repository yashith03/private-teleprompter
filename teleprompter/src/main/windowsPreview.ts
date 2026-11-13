import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

let shuttingDown = false;
app.once('before-quit', () => {
  shuttingDown = true;
});

function resolveHelperPaths(): { helperExe: string; logoPng: string } | null {
  const winDir = app.isPackaged
    ? path.join(process.resourcesPath, 'windows')
    : path.join(__dirname, 'windows');
  const helperExe = path.join(winDir, 'dwmHelper.exe');
  const logoPng = path.join(winDir, 'logo.png');

  if (helperExe.includes('app.asar') || !fs.existsSync(helperExe)) {
    return null;
  }
  return { helperExe, logoPng };
}

/**
 * Configure Windows Desktop Window Manager (DWM) attributes on the BrowserWindow HWND:
 * 1. DWMWA_DISALLOW_PEEK (11): Disallows full-screen live Peek preview when hovering over the taskbar thumbnail.
 * 2. DWMWA_EXCLUDED_FROM_PEEK (12): Excludes this window from Peek when other windows are peeked.
 * 3. DWMWA_FORCE_ICONIC_REPRESENTATION (7): Tells DWM to request or accept an iconic bitmap instead of live window content.
 * 4. DWMWA_HAS_ICONIC_BITMAP (10): Signals that the window provides iconic representation.
 * 5. Sets the iconic thumbnail and live preview bitmap to the static app logo so no speech text is shown in hover previews.
 */
export function applyWindowsTaskbarPreviewProtection(win: BrowserWindow): void {
  if (process.platform !== 'win32' || shuttingDown || win.isDestroyed()) return;

  try {
    const resolved = resolveHelperPaths();
    if (!resolved) return;

    const handle = win.getNativeWindowHandle();
    // HWND on Windows x64 is a 64-bit integer stored little-endian
    const hwnd = handle.length >= 8 ? handle.readBigInt64LE(0).toString() : handle.readInt32LE(0).toString();

    const args = [hwnd];
    if (fs.existsSync(resolved.logoPng)) args.push(resolved.logoPng);

    const child = spawn(resolved.helperExe, args, {
      windowsHide: true,
      stdio: 'ignore',
      detached: true
    });
    child.on('error', () => {
      // Swallow spawn errors so no Electron crash dialog appears.
    });
    child.unref();
  } catch {
    // Non-fatal if DWM configuration cannot be run
  }
}
