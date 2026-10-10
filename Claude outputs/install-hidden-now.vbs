' FastAPN - install-hidden-now.vbs
' Double-click once per PC. No console window. Writes D:\apps\fastapn-run-hidden.vbs and
' repoints HKCU fastapn-sp:// (SharePoint) and fastapn:// (Outlook) handlers to it. No admin needed.
Option Explicit
Dim sh, fso, q, base, vbsPath, f, keys, ps1s, i, ck, cur, want, msg, leaf, n
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)
base = "D:\apps"
If Not fso.FolderExists(base) Then fso.CreateFolder base
vbsPath = base & "\fastapn-run-hidden.vbs"
Set f = fso.CreateTextFile(vbsPath, True, False)
f.WriteLine "' FastAPN run-hidden launcher: starts a PowerShell script with NO console window."
f.WriteLine "Option Explicit"
f.WriteLine "Dim sh, q, cmd, i"
f.WriteLine "If WScript.Arguments.Count < 1 Then WScript.Quit 1"
f.WriteLine "Set sh = CreateObject(""WScript.Shell"")"
f.WriteLine "q = Chr(34)"
f.WriteLine "cmd = ""powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "" & q & WScript.Arguments(0) & q"
f.WriteLine "For i = 1 To WScript.Arguments.Count - 1"
f.WriteLine "  cmd = cmd & "" "" & q & WScript.Arguments(i) & q"
f.WriteLine "Next"
f.WriteLine "sh.Run cmd, 0, False"
f.Close
keys = Array("HKCU\Software\Classes\fastapn-sp\shell\open\command\", "HKCU\Software\Classes\fastapn\shell\open\command\")
ps1s = Array(base & "\fastapn-sp.ps1", base & "\fastapn-outlook.ps1")
msg = "Hidden launcher installed: " & vbsPath & vbCrLf
n = 0
For i = 0 To 1
  If fso.FileExists(ps1s(i)) Then
    leaf = fso.GetFileName(ps1s(i))
    cur = ""
    On Error Resume Next
    cur = sh.RegRead(keys(i))
    On Error GoTo 0
    If InStr(1, cur, leaf, vbTextCompare) > 0 Then
      want = "wscript.exe //B //Nologo " & q & vbsPath & q & " " & q & ps1s(i) & q & " " & q & "%1" & q
      sh.RegWrite keys(i), want, "REG_SZ"
      msg = msg & "Updated: " & leaf & vbCrLf
      n = n + 1
    Else
      msg = msg & "Skipped (handler not registered): " & leaf & vbCrLf
    End If
  Else
    msg = msg & "Skipped (file not found): " & leaf & vbCrLf
  End If
Next
MsgBox msg, vbInformation, "FastAPN hidden launcher"
