# 输出当前前台窗口的标题与进程名（给桌宠判断"用户正在用什么软件"）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File foreground.ps1
Add-Type -Namespace DsPet -Name Fg -MemberDefinition @'
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
'@

$h = [DsPet.Fg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][DsPet.Fg]::GetWindowTextW($h, $sb, 512)
$procId = 0
[void][DsPet.Fg]::GetWindowThreadProcessId($h, [ref]$procId)
$procName = ''
try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
$title = $sb.ToString()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output ("TITLE=" + $title)
Write-Output ("PROC=" + $procName)
