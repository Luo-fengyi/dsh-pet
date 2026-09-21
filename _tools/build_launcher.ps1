# 重新编译「启动桌宠.exe」（改了 launcher.cs 或想换图标时跑这个）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File _tools/build_launcher.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$src = Join-Path $root '_tools\launcher.cs'
$ico = Join-Path $root '_tools\ds-pet.ico'
$out = Join-Path $root '启动桌宠.exe'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "找不到 C# 编译器：$csc（装个 .NET Framework 4.x 就有了）" }

# 源码存成 UTF-8 with BOM，否则 csc 会把中文读成乱码
$code = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($src, $code, (New-Object System.Text.UTF8Encoding $true))

$args = @('/nologo', '/target:winexe', "/out:$out", '/reference:System.Windows.Forms.dll')
if (Test-Path $ico) { $args += "/win32icon:$ico" }
$args += $src

Remove-Item $out -Force -ErrorAction SilentlyContinue
& $csc @args
if (-not (Test-Path $out)) { throw '编译失败' }
Write-Output ('编译完成：' + $out + '  ' + [math]::Round((Get-Item $out).Length / 1KB, 1) + 'KB')
