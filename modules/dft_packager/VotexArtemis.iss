; VotexArtemis — bağımsız kurulum (kullanıcı sadece bunu çalıştırır)
; Derleme: build_single_setup.py --artemis → ISCC
;
; Ayrı program sözleşmesi:
;   • Kendi AppId'si ve {autopf}\VotexArtemis klasörü vardır; mevcut
;     DFT_Suite / VOTEX / DerinTaramaAsistan kurulumlarına DOKUNMAZ.
;   • Eski kurulum kaldırıcılarını çalıştırmaz, süreç kapatmaz
;     (yalnız kendi VotexArtemis.exe sürecini kapatır).
;   • Runtime'lar (VC++/WebView2/Node/Rust) sistemde yoksa sessiz kurulur;
;     varsa atlanır (Pascal kodundaki HasX kontrolleri).
;   • Kullanıcı verileri %APPDATA%\VotexArtemis altında ayrık tutulur.

#define MyAppName "VotexArtemis"
#define MyAppVersion "0.4.164"
#define MyAppPublisher "Digital Future Tech"
#define MyAppURL "https://digitalfuture.tech"

[Setup]
AppId={{B8F4D3C2-ART2-5F9B-A012-VOTEXART0002}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\VotexArtemis
UsePreviousAppDir=no
DefaultGroupName=VotexArtemis
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=VotexArtemis_Setup_0.4.164
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\VotexArtemis.exe
InfoBeforeFile=staging_artemis\INFO_BEFORE.txt
DisableWelcomePage=no
; Yalnız kendi sürecini kapatır — Votex.exe'ye dokunmaz.
CloseApplications=yes
CloseApplicationsFilter=VotexArtemis.exe
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu"; GroupDescription: "Ek görevler:"; Flags: checkedonce

[Files]
; --- Runtimes (Pascal kodunda varlık kontrolüyle koşullu kurulur) ---
Source: "staging_artemis\runtimes\*"; DestDir: "{tmp}\artemis_runtimes"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- VotexArtemis uygulaması (ayrı klasör; DFT_Suite ile çakışmaz) ---
Source: "staging_artemis\VotexArtemis\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\VotexArtemis"; Filename: "{app}\VotexArtemis.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\VotexArtemis"; Filename: "{app}\VotexArtemis.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; VC++ — yalnız eksikse
Filename: "{tmp}\artemis_runtimes\VC_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "VC++ kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; WebView2 — yalnız eksikse
Filename: "{tmp}\artemis_runtimes\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "WebView2 kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; Node.js — yalnız eksikse
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\artemis_runtimes\node-lts-x64.msi"" /qn /norestart"; StatusMsg: "Node.js kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; Rust — yalnız eksikse
Filename: "{tmp}\artemis_runtimes\rustup-init.exe"; Parameters: "-y --default-toolchain stable"; StatusMsg: "Rust kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

Filename: "{app}\VotexArtemis.exe"; Description: "VotexArtemis'i aç"; Flags: nowait postinstall skipifsilent skipifdoesntexist

[Code]
function HasVCRedist(): Boolean;
begin
  Result := RegKeyExists(HKEY_LOCAL_MACHINE,
    'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64');
end;

function HasWebView2(): Boolean;
var
  Ver: String;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', Ver)
    or RegQueryStringValue(HKEY_CURRENT_USER,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', Ver);
end;

function HasNode(): Boolean;
begin
  Result := DirExists(ExpandConstant('{pf}\nodejs'))
    or RegKeyExists(HKEY_LOCAL_MACHINE, 'SOFTWARE\Node.js');
end;

function HasRust(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userprofile}\.cargo\bin'))
    and FileExists(ExpandConstant('{userprofile}\.cargo\bin\rustc.exe'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  NeedsRestart := False;
  // Yalnız kendi süreci; Votex.exe/DTA süreçlerine dokunulmaz.
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM VotexArtemis.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  NodeMsi, RustInit: String;
begin
  if CurStep <> ssPostInstall then
    exit;

  // [Run] girdileri koşulsuz listelendiği için koşullu çalıştırma burada yapılır.
  NodeMsi := ExpandConstant('{tmp}\artemis_runtimes\node-lts-x64.msi');
  RustInit := ExpandConstant('{tmp}\artemis_runtimes\rustup-init.exe');

  if not HasVCRedist() then
    Exec(ExpandConstant('{tmp}\artemis_runtimes\VC_redist.x64.exe'),
      '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if not HasWebView2() then
    Exec(ExpandConstant('{tmp}\artemis_runtimes\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'),
      '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if (not HasNode()) and FileExists(NodeMsi) then
    Exec('msiexec.exe', '/i "' + NodeMsi + '" /qn /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if (not HasRust()) and FileExists(RustInit) then
    Exec(RustInit, '-y --default-toolchain stable', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
