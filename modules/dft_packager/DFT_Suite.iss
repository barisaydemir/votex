; DFT Suite — tek Setup.exe (kullanıcı sadece bunu çalıştırır)
; Derleme: build_single_setup.py → ISCC
;
; Ayrıcalık modeli: PrivilegesRequired=admin + makine-başı {autopf} kurulum.
; Bu ikisi birlikte tutarlıdır: yönetici modunda kurulan dosyalar her kullanıcının
; erişebileceği ortak Program Files konumuna yazılır. Eski model (admin + {localappdata})
; yönetici hesabının kendi profiline kuruyordu; normal kullanıcı uygulamayı göremezdi.

#define MyAppName "DFT Suite"
#define MyAppVersion "0.4.110"
#define MyAppPublisher "Digital Future Tech"
#define MyAppURL "https://digitalfuture.tech"

[Setup]
AppId={{A7E3C2B1-DFT1-4E8A-9F01-VOTEXDTA0001}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\DFT_Suite
; Eski per-user kurulumun HKCU AppDir kaydı yeni makine-başı kurulumu eski
; konuma çekmesin: hedef her zaman {autopf}.
UsePreviousAppDir=no
DefaultGroupName=DFT Suite
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=DFT_Suite_Setup_0.4.110
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\VOTEX\Votex.exe
InfoBeforeFile=staging\INFO_BEFORE.txt
DisableWelcomePage=no
; Yeni paket mevcut VOTEX/DTA süreçlerini kapatıp eski kurulumları sessizce kaldırır.
; VOTEX doğrudan staging\VOTEX içinden tek kez kurulur; nested Tauri setup kullanılmaz.
CloseApplications=yes
CloseApplicationsFilter=Votex.exe
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolları"; GroupDescription: "Ek görevler:"; Flags: checkedonce

[Files]
; --- Runtimes (kurulum sırasında sessiz çalıştırılır) ---
Source: "staging\runtimes\*"; DestDir: "{tmp}\dft_runtimes"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- VOTEX uygulama (makine-başı: {autopf}) ---
Source: "staging\VOTEX\*"; DestDir: "{autopf}\VOTEX"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- DTA uygulama (Python yığını, makine-başı: {autopf}) ---
Source: "staging\DTA\*"; DestDir: "{autopf}\DerinTaramaAsistan"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\VOTEX"; Filename: "{autopf}\VOTEX\Votex.exe"; WorkingDir: "{autopf}\VOTEX"
Name: "{group}\Derin Tarama Asistan"; Filename: "{autopf}\DerinTaramaAsistan\baslat.vbs"; WorkingDir: "{autopf}\DerinTaramaAsistan"
Name: "{autodesktop}\VOTEX"; Filename: "{autopf}\VOTEX\Votex.exe"; Tasks: desktopicon
Name: "{autodesktop}\Derin Tarama Asistan"; Filename: "{autopf}\DerinTaramaAsistan\baslat.vbs"; Tasks: desktopicon

[Run]
; VC++
Filename: "{tmp}\dft_runtimes\VC_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "VC++ kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; WebView2
Filename: "{tmp}\dft_runtimes\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "WebView2 kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; Node.js (VOTEX)
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\dft_runtimes\node-lts-x64.msi"" /qn /norestart"; StatusMsg: "Node.js kuruluyor (VOTEX)…"; Flags: waituntilterminated skipifdoesntexist

; Rust (VOTEX)
Filename: "{tmp}\dft_runtimes\rustup-init.exe"; Parameters: "-y --default-toolchain stable"; StatusMsg: "Rust kuruluyor (VOTEX)…"; Flags: waituntilterminated skipifdoesntexist

; Ayar yaz
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\dft_runtimes\write_settings.ps1"""; StatusMsg: "Ayarlar…"; Flags: waituntilterminated skipifdoesntexist runhidden

; DTA paketleri gömülü Python'a (venv yok) — VoteX'e dokunmaz
Filename: "{autopf}\DerinTaramaAsistan\runtime\python312-amd64\python.exe"; Parameters: """{autopf}\DerinTaramaAsistan\launcher.py"" --silent-setup"; WorkingDir: "{autopf}\DerinTaramaAsistan"; StatusMsg: "Derin Tarama Asistan hazırlanıyor…"; Flags: waituntilterminated skipifdoesntexist

Filename: "{autopf}\VOTEX\Votex.exe"; Description: "VOTEX'i aç"; Flags: nowait postinstall skipifsilent skipifdoesntexist

[Code]
const
  LegacyVotexDir = 'Programs\VOTEX';
  LegacySuiteDir = 'Programs\DFT_Suite';

// Eski per-user kurulum konumları (localappdata) ve yeni makine-başı konum.
// Eski kaldırıcılar mevcutsa sessiz çalıştır; başarısız olsa da kurulum devam eder.
function RunSilentUninstaller(const Uninstaller, Parameters: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not FileExists(Uninstaller) then
    exit;

  Log(Format('Eski kurulum kaldırılıyor: %s', [Uninstaller]));
  if not Exec(Uninstaller, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := False;
    Log(Format('Kaldırıcı başlatılamadı (%d): %s', [ResultCode, Uninstaller]));
  end
  else if ResultCode <> 0 then
  begin
    Result := False;
    Log(Format('Kaldırıcı başarısız (%d): %s', [ResultCode, Uninstaller]));
  end;
end;

procedure RunLegacyUninstallers();
var
  LocalBase: String;
  FilesBase: String;
begin
  // Eski per-user kurulumlar (0.4.96 oncesi): localappdata\Programs\...
  LocalBase := ExpandConstant('{localappdata}');
  RunSilentUninstaller(LocalBase + '\' + LegacyVotexDir + '\uninstall.exe', '/S');
  RunSilentUninstaller(LocalBase + '\' + LegacySuiteDir + '\unins000.exe', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');

  // Onceki makine-basi kurulum (varsa): Program Files\DFT_Suite
  FilesBase := ExpandConstant('{autopf}');
  RunSilentUninstaller(FilesBase + '\DFT_Suite\unins000.exe', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  NeedsRestart := False;

  { Sadece VOTEX sürecini kapat; kullanıcı verilerine dokunma. }
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM Votex.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Eski kaldırıcı kilitli/eksik olsa bile yeni paket kurulabilir.
    Kaldırma yalnızca temizlik kolaylığıdır; hata kurulumu durdurmaz. }
  RunLegacyUninstallers();
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
end;
