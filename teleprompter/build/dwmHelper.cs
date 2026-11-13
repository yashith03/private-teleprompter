using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public class Program {
    public const int DWMWA_DISALLOW_PEEK = 11;
    public const int DWMWA_EXCLUDED_FROM_PEEK = 12;
    public const int DWMWA_FORCE_ICONIC_REPRESENTATION = 7;
    public const int DWMWA_HAS_ICONIC_BITMAP = 10;

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int attrValue, int attrSize);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetIconicThumbnail(IntPtr hwnd, IntPtr hbmp, uint flags);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetIconicLivePreviewBitmap(IntPtr hwnd, IntPtr hbmp, IntPtr pptClient, uint flags);

    [DllImport("dwmapi.dll")]
    public static extern int DwmInvalidateIconicBitmaps(IntPtr hwnd);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    public static int Main(string[] args) {
        if (args.Length < 1) return 1;
        long hwndNum = 0;
        if (!long.TryParse(args[0], out hwndNum)) return 2;
        IntPtr hwnd = new IntPtr(hwndNum);
        string iconFile = args.Length > 1 ? args[1] : null;

        int valTrue = 1;
        DwmSetWindowAttribute(hwnd, DWMWA_DISALLOW_PEEK, ref valTrue, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_EXCLUDED_FROM_PEEK, ref valTrue, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, ref valTrue, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_HAS_ICONIC_BITMAP, ref valTrue, sizeof(int));

        if (!string.IsNullOrEmpty(iconFile) && File.Exists(iconFile)) {
            try {
                using (Image src = Image.FromFile(iconFile)) {
                    // Create a 200x200 padded icon on clean background
                    using (Bitmap bmp = new Bitmap(200, 200, PixelFormat.Format32bppArgb)) {
                        using (Graphics g = Graphics.FromImage(bmp)) {
                            g.Clear(Color.FromArgb(240, 244, 255));
                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                            // draw logo centered with margin
                            g.DrawImage(src, 24, 24, 152, 152);
                        }
                        IntPtr hBitmap = bmp.GetHbitmap();
                        DwmSetIconicThumbnail(hwnd, hBitmap, 0);
                        DwmSetIconicLivePreviewBitmap(hwnd, hBitmap, IntPtr.Zero, 0);
                        DeleteObject(hBitmap);
                    }
                }
            } catch (Exception ex) {
                // non-fatal
            }
        }
        DwmInvalidateIconicBitmaps(hwnd);
        return 0;
    }
}
