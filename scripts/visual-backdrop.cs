// Test-only synthetic desktop. Never used by the shipped application.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class StarryVisualBackdrop : Form {
    public string Scene = "light";
    Form focusSink;
    public StarryVisualBackdrop() {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen.Bounds;
        DoubleBuffered = true;
        Text = "Starry List synthetic visual test";
    }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out int value, uint size);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    delegate bool WindowVisitor(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor callback, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    static Rectangle BoundsOf(IntPtr window) {
        Rect r; if (!GetWindowRect(window, out r)) throw new Exception("Cannot read test window bounds");
        return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
    }
    // The backdrop must cover every captured pixel. Reject unrelated windows
    // above it, including windows behind the transparent test application.
    void Guard(Rectangle area, uint appProcess, bool inactive) {
        uint foreground; GetWindowThreadProcessId(GetForegroundWindow(), out foreground);
        bool correctFocus = inactive ? focusSink != null && GetForegroundWindow() == focusSink.Handle && !focusSink.Bounds.IntersectsWith(area) : foreground == appProcess;
        if (!correctFocus || !BoundsOf(Handle).Contains(area))
            throw new Exception("Capture refused: test foreground or synthetic coverage changed");
        bool found = false, appSeen = false, unsafeWindow = false;
        string unsafeClass = "none";
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            if (window == Handle) { found = true; return false; }
            if (!IsWindowVisible(window)) return true;
            int cloaked;
            // Cloaked shell windows retain WS_VISIBLE but are not composed.
            // On query failure keep the conservative capture refusal behavior.
            if (DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            uint process; GetWindowThreadProcessId(window, out process);
            if (process == appProcess) appSeen = true;
            if (process != appProcess && process != (uint)System.Diagnostics.Process.GetCurrentProcess().Id && BoundsOf(window).IntersectsWith(area)) {
                var name = new System.Text.StringBuilder(128);
                GetClassName(window, name, 128);
                unsafeClass = name.ToString() + ", bounds=" + BoundsOf(window).ToString(); // No window titles or content.
                unsafeWindow = true; return false;
            }
            return true;
        }, IntPtr.Zero);
        if (!found || !appSeen || unsafeWindow) throw new Exception("Capture refused: unrelated window may appear in the region (backdrop=" + found + ", app=" + appSeen + ", class=" + unsafeClass + ")");
    }
    public void CaptureRegion(string path, uint appProcess, IntPtr appWindow, int blurMargin, bool inactive) {
        Rectangle area = BoundsOf(appWindow);
        // Acrylic may sample beyond the window. Keep that region synthetic too.
        Rectangle guarded = Rectangle.Inflate(area, blurMargin, blurMargin);
        Guard(guarded, appProcess, inactive);
        using (Bitmap pixels = new Bitmap(area.Width, area.Height)) {
            using (Graphics g = Graphics.FromImage(pixels))
                g.CopyFromScreen(area.Location, Point.Empty, area.Size);
            Guard(guarded, appProcess, inactive);
            pixels.Save(path, ImageFormat.Png);
        }
    }
    public void FocusAway() {
        if (focusSink == null) {
            focusSink = new Form { Text = "Synthetic focus target", FormBorderStyle = FormBorderStyle.None, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Bounds = new Rectangle(Left + 10, Top + 10, 110, 50), BackColor = Color.FromArgb(220, 208, 244) };
            focusSink.Controls.Add(new Label { Text = "Focus test", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter });
            FormClosed += delegate { focusSink.Dispose(); };
        }
        focusSink.Show(); focusSink.BringToFront(); focusSink.Activate();
        Point point = new Point(focusSink.Left + 20, focusSink.Top + 20);
        if (GetAncestor(WindowFromPoint(point), 2) != focusSink.Handle) throw new Exception("Focus test refused: target is covered");
        Cursor.Position = point;
        mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
    }
    public int BackdropType(IntPtr appWindow) {
        int value;
        return DwmGetWindowAttribute(appWindow, 38, out value, 4) == 0 ? value : -1;
    }
    public void PlaceBehind(uint appProcess, IntPtr appWindow) {
        uint process; GetWindowThreadProcessId(appWindow, out process);
        if (process != appProcess || !IsWindowVisible(appWindow))
            throw new Exception("Staging refused: not the isolated test window");
        // Move only this synthetic background, directly below its test app.
        if (!SetWindowPos(Handle, appWindow, 0, 0, 0, 0, 0x13))
            throw new Exception("Cannot position synthetic backdrop");
    }
    public void ParkPointer(uint appProcess, IntPtr appWindow) {
        uint process; GetWindowThreadProcessId(appWindow, out process);
        if (process != appProcess || !IsWindowVisible(appWindow))
            throw new Exception("Pointer refused: not the isolated test window");
        Rectangle bounds = BoundsOf(appWindow);
        // CDP mouse events do not move the real OS cursor; native WebView title
        // tooltips can otherwise outlive a navigation. Move, never click.
        Cursor.Position = new Point(bounds.Left + 10, bounds.Top + 10);
    }
    public void DragRegion(uint appProcess, IntPtr appWindow, int fromX, int fromY, int toX, int toY) {
        uint foreground;
        GetWindowThreadProcessId(GetForegroundWindow(), out foreground);
        // WebView2 child HWNDs can belong to its renderer process. Validate the
        // exact root window instead of assuming all child windows share a PID.
        IntPtr target = GetAncestor(WindowFromPoint(new Point(fromX, fromY)), 2);
        if (foreground != appProcess || target != appWindow || !BoundsOf(Handle).Contains(BoundsOf(appWindow)))
            throw new Exception("Drag refused: target is not the foreground test application");
        Cursor.Position = new Point(fromX, fromY);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero);
        try {
            System.Threading.Thread.Sleep(100);
            for (int step = 1; step <= 10; step++) {
                Cursor.Position = new Point(fromX + (toX - fromX) * step / 10, fromY + (toY - fromY) * step / 10);
                System.Threading.Thread.Sleep(25);
            }
        } finally { mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
        GetWindowThreadProcessId(GetForegroundWindow(), out foreground);
        if (foreground != appProcess) throw new Exception("Drag interrupted: test application lost foreground");
    }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Scene == "dark" ? Color.FromArgb(22, 18, 44) : Color.FromArgb(230, 237, 247));
        if (Scene == "light") {
            using (Brush b = new SolidBrush(Color.FromArgb(216, 226, 243))) g.FillEllipse(b, Width / 2, -200, Width, Height);
        } else if (Scene == "dark") {
            using (Pen p = new Pen(Color.FromArgb(98, 81, 145), 5))
                for (int x = 80; x < Width; x += 190) g.DrawEllipse(p, x, 60 + x % 400, 160, 160);
        } else if (Scene == "colorful") {
            Color[] colors = { Color.FromArgb(20, 32, 80), Color.FromArgb(244, 185, 34), Color.FromArgb(226, 59, 101), Color.FromArgb(31, 150, 155) };
            for (int y = 0; y < Height; y += 120)
                for (int x = 0; x < Width; x += 180)
                    using (Brush b = new SolidBrush(colors[(x / 180 + y / 120) % colors.Length])) g.FillRectangle(b, x, y, 180, 120);
            using (Pen p = new Pen(Color.White, 8)) for (int x = -Height; x < Width; x += 270) g.DrawLine(p, x, 0, x + Height, Height);
        } else if (Scene == "text") {
            g.Clear(Color.FromArgb(247, 248, 251));
            using (Font font = new Font("Microsoft YaHei UI", 17))
                for (int y = 10; y < Height; y += 46)
                    for (int x = 8; x < Width; x += 480) {
                        using (Brush b = new SolidBrush(Color.FromArgb(44, 37, 67))) g.DrawString("合成窗口 ABC 0123456789 测试文字", font, b, x, y);
                        using (Brush b = new SolidBrush(Color.FromArgb(124, 96, 170))) g.FillRectangle(b, x + 4, y + 32, 24, 9);
                    }
        }
        base.OnPaint(e);
    }
}
