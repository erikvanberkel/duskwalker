// Duskwalker.exe: a tiny, fully self-contained Windows launcher.
// The whole game (one HTML file) is embedded in this exe as a resource. On launch it is
// written to %LOCALAPPDATA%\Duskwalker and opened in a chromeless Microsoft Edge app window
// (Edge ships with Windows 10/11) with WebGL pinned to Direct3D 11.
// Compiled with the C# compiler that comes with Windows (.NET Framework 4.x): see tools/build-exe.mjs.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Duskwalker")]
[assembly: AssemblyDescription("Duskwalker - a Mirage production")]
[assembly: AssemblyProduct("Duskwalker")]
[assembly: AssemblyCompany("Mirage")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Mirage")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    [STAThread]
    static int Main()
    {
        try
        {
            string home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Duskwalker");
            Directory.CreateDirectory(home);
            string page = Path.Combine(home, "Duskwalker.html");
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("Duskwalker.html"))
            using (FileStream dst = File.Create(page))
            {
                src.CopyTo(dst);
            }

            string edge = FindEdge();
            if (edge == null)
            {
                // No Edge: fall back to the default browser, which can run the same file.
                Process.Start(page);
                return 0;
            }

            string[] flags = {
                "--app=\"" + new Uri(page).AbsoluteUri + "\"",
                "--user-data-dir=\"" + Path.Combine(home, "EdgeProfile") + "\"",
                "--use-angle=d3d11",
                "--window-size=1600,900",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-features=Translate",
                "--disable-background-timer-throttling",
            };
            string args = string.Join(" ", flags);
            string port = Environment.GetEnvironmentVariable("DUSK_DEBUG_PORT");
            if (!string.IsNullOrEmpty(port)) args += " --remote-debugging-port=" + port;

            ProcessStartInfo psi = new ProcessStartInfo(edge, args);
            psi.UseShellExecute = false;
            Process.Start(psi);
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("Duskwalker could not start:\n\n" + e.Message, "Duskwalker", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static string FindEdge()
    {
        foreach (RegistryKey hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            using (RegistryKey key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
            {
                string path = key == null ? null : key.GetValue(null) as string;
                if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
            }
        }
        foreach (string name in new[] { "ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA" })
        {
            string root = Environment.GetEnvironmentVariable(name);
            if (root == null) continue;
            string path = Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(path)) return path;
        }
        return null;
    }
}
