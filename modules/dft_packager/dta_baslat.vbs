' DTA acilis — her zaman launcher (ilk kurulum + hata penceresi)
Option Explicit
Dim sh, fso, dir, embedPy, embedPyw, launcher
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
embedPy = dir & "\runtime\python312-amd64\python.exe"
embedPyw = dir & "\runtime\python312-amd64\pythonw.exe"
launcher = dir & "\launcher.py"

If Not fso.FileExists(embedPy) And Not fso.FileExists(embedPyw) Then
  MsgBox "Gomulu Python yok (runtime\python312-amd64)." & vbCrLf & _
         "DTA_ONAR.bat veya kurulum paketini yeniden deneyin.", 16, "DTA"
  WScript.Quit 1
End If

If Not fso.FileExists(launcher) Then
  MsgBox "launcher.py yok. Paketi yeniden kopyalayin.", 16, "DTA"
  WScript.Quit 1
End If

sh.Environment("PROCESS")("PATH") = dir & "\runtime\python312-amd64;" & _
  sh.ExpandEnvironmentStrings("%PATH%")
sh.Environment("PROCESS")("PYTHONNOUSERSITE") = "1"
sh.Environment("PROCESS")("PYTHONUNBUFFERED") = "1"

' python.exe: splash/tk yoksa MessageBox gorunsun (pythonw sessiz oluyor)
If fso.FileExists(embedPy) Then
  sh.Run """" & embedPy & """ """ & launcher & """", 0, False
Else
  sh.Run """" & embedPyw & """ """ & launcher & """", 0, False
End If
WScript.Quit 0
