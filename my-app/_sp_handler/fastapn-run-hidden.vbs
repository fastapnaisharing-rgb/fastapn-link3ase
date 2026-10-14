' FastAPN run-hidden launcher: starts a PowerShell script with NO console window.
' Usage: wscript.exe //B //Nologo fastapn-run-hidden.vbs "<script.ps1>" [args...]
Option Explicit
Dim sh, q, cmd, i
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
q = Chr(34)
cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & q & WScript.Arguments(0) & q
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " " & q & WScript.Arguments(i) & q
Next
sh.Run cmd, 0, False
