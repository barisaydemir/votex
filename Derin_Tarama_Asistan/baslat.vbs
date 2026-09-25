' Konsolsuz DTA açılış — launcher.py (Tk splash)
Option Explicit
Dim sh, fso, dir, launcher, cmd, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = dir & "\launcher.py"

If Not fso.FileExists(launcher) Then
  MsgBox "launcher.py bulunamadı:" & vbCrLf & launcher, 16, "Derin Tarama Asistan"
  WScript.Quit 1
End If

' Tercih: pyw / pythonw (penceresiz)
rc = sh.Run("cmd /c where pyw >nul 2>&1", 0, True)
If rc = 0 Then
  sh.Run "pyw -3.12 """ & launcher & """", 0, False
  WScript.Quit 0
End If

rc = sh.Run("cmd /c where pythonw >nul 2>&1", 0, True)
If rc = 0 Then
  sh.Run "pythonw """ & launcher & """", 0, False
  WScript.Quit 0
End If

If fso.FileExists(dir & "\.venv_jarvis\Scripts\pythonw.exe") Then
  sh.Run """" & dir & "\.venv_jarvis\Scripts\pythonw.exe"" """ & launcher & """", 0, False
  WScript.Quit 0
End If

' Fallback
sh.Run "py -3.12 """ & launcher & """", 1, False
