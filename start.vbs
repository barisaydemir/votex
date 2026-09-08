' VOTEX launcher with error pop-up diagnostic
Option Explicit
Dim sh, fso, dir, logDir, logFile, rc

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = dir & "\logs"
logFile = logDir & "\votex-start.log"

If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir

If IsVotexExeRunning() Then
  On Error Resume Next
  Dim activated
  activated = sh.AppActivate("Votex - Manyetik Anomali Analiz")
  On Error GoTo 0
  If activated Then
    WriteLog "already running (votex.exe) - focus"
    WScript.Quit 0
  Else
    WriteLog "zombie votex.exe detected - killing"
    sh.Run "taskkill /F /IM votex.exe", 0, True
    WScript.Sleep 500
  End If
End If

' Onceki yarim kalmis tauri/vite/splash temizle
CloseBootSplash
KillStaleDevStack

rc = sh.Run("cmd /c where node >nul 2>&1", 0, True)
If rc <> 0 Then
  ShowError "Node.js bulunamadi." & vbCrLf & "https://nodejs.org"
  WScript.Quit 1
End If

rc = sh.Run("cmd /c where cargo >nul 2>&1", 0, True)
If rc <> 0 Then
  ShowError "Rust/Cargo bulunamadi." & vbCrLf & "https://rustup.rs"
  WScript.Quit 1
End If

If fso.FileExists(dir & "\boot-splash.hta") Then
  sh.Run "mshta.exe """ & dir & "\boot-splash.hta""", 1, False
End If

If Not fso.FolderExists(dir & "\node_modules") Then
  WriteLog "npm install..."
  rc = sh.Run( _
    "cmd /c cd /d """ & dir & """ && npm install > """ & logFile & """ 2>&1", _
    0, True)
  If rc <> 0 Then
    ShowErrorLog "npm install basarisiz oldu!", logFile
    WScript.Quit rc
  End If
End If

WriteLog "npm run tauri dev..."
' Cursor sandbox CARGO_TARGET_DIR kalintisini temizle ve baslat
rc = sh.Run( _
  "cmd /c cd /d """ & dir & """ && set CARGO_TARGET_DIR=&& set CARGO_BUILD_TARGET_DIR=&& npm run tauri dev > """ & logFile & """ 2>&1", _
  0, False)

WScript.Quit 0

Function IsVotexExeRunning()
  Dim wmi, procs
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='votex.exe'")
  If Err.Number <> 0 Then
    IsVotexExeRunning = False
    Err.Clear
    Exit Function
  End If
  IsVotexExeRunning = (procs.Count > 0)
  On Error GoTo 0
End Function

Sub CloseBootSplash()
  Dim wmi, procs, p, cmd
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='mshta.exe'")
  If Err.Number <> 0 Then Exit Sub
  For Each p In procs
    cmd = LCase("" & p.CommandLine)
    If InStr(cmd, "boot-splash.hta") > 0 Then
      sh.Run "taskkill /PID " & p.ProcessId & " /F", 0, True
    End If
  Next
End Sub

Sub KillStaleDevStack()
  Dim wmi, procs, p, cmd, dirL
  dirL = LCase(dir)
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId, Name, CommandLine FROM Win32_Process")
  If Err.Number <> 0 Then Exit Sub
  For Each p In procs
    cmd = LCase("" & p.CommandLine)
    If InStr(cmd, dirL) > 0 Then
      If InStr(cmd, "tauri") > 0 Or InStr(cmd, "vite") > 0 Or InStr(cmd, "npm-cli.js"" run tauri") > 0 Then
        sh.Run "taskkill /PID " & p.ProcessId & " /T /F", 0, True
      End If
    End If
  Next
  WScript.Sleep 800
End Sub

Sub WriteLog(t)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(logFile, 8, True)
  f.WriteLine "[" & Now & "] " & t
  f.Close
End Sub

Function ReadLastLines(filePath, maxLines)
  On Error Resume Next
  ReadLastLines = ""
  If Not fso.FileExists(filePath) Then Exit Function
  Dim f, content, lines
  Set f = fso.OpenTextFile(filePath, 1, False)
  content = f.ReadAll()
  f.Close()
  lines = Split(content, vbCrLf)
  Dim count, i, startIdx
  count = UBound(lines) + 1
  startIdx = count - maxLines
  If startIdx < 0 Then startIdx = 0
  Dim result
  result = ""
  For i = startIdx To count - 1
    result = result & lines(i) & vbCrLf
  Next
  ReadLastLines = result
End Function

Sub ShowError(headline)
  MsgBox headline, 16, "VOTEX Baslatma Hatasi"
End Sub

Sub ShowErrorLog(headline, logPath)
  Dim snippet
  snippet = ReadLastLines(logPath, 15)
  MsgBox headline & vbCrLf & vbCrLf & "Hata Detayi (Son Loglar):" & vbCrLf & snippet & vbCrLf & "Detayli log dosyasi aciliyor...", 16, "VOTEX Hata Bildirimi"
  sh.Run "notepad.exe """ & logPath & """", 1, False
End Sub