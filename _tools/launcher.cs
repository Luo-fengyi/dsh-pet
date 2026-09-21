// DS娘桌宠启动器
// 作用：双击就启动桌宠（无控制台窗口），并且是标准的 exe（比 .vbs 更不容易被杀软/系统拦）
// 编译：见 _tools/build_launcher.ps1
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class DsPetLauncher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string electron = Path.Combine(dir, "node_modules", "electron", "dist", "electron.exe");

        if (!File.Exists(electron))
        {
            MessageBox.Show(
                "找不到 Electron 运行时：\n" + electron + "\n\n" +
                "请把这个 exe 放在 dsh-pet 目录里（和 node_modules 同一层），\n" +
                "如果是从压缩包解压的，注意别只拷了 exe 出来。",
                "DS娘桌宠 · 启动失败",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            // electron.exe 后面跟 app 目录，就是"用这个 Electron 跑这个应用"
            var psi = new ProcessStartInfo(electron, "\"" + dir + "\"");
            psi.WorkingDirectory = dir;
            psi.UseShellExecute = false;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败：" + ex.Message, "DS娘桌宠 · 启动失败",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
