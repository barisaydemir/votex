; DFT Suite — tek Setup.exe (kullanıcı sadece bunu çalıştırır)
; Derleme: build_single_setup.py → ISCC

#define MyAppName "DFT Suite"
#define MyAppVersion "0.4.21"
#define MyAppPublisher "Digital Future Tech"
#define MyAppURL "https://digitalfuture.tech"

[Setup]
AppId={{A7E3C2B1-DFT1-4E8A-9F01-VOTEXDTA0001}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\DFT_Suite
DefaultGroupName=DFT Suite
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=DFT_Suite_Setup_0.4.21
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={localappdata}\Programs\VOTEX\Votex.exe
InfoBeforeFile=staging\INFO_BEFORE.txt
DisableWelcomePage=no
; Yeni paket mevcut VOTEX/DTA süreçlerini kapatıp eski kurulumları sessizce kaldırır.
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

; --- VOTEX uygulama ---
Source: "staging\VOTEX\*"; DestDir: "{localappdata}\Programs\VOTEX"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- DTA uygulama (Python yığını) ---
Source: "staging\DTA\*"; DestDir: "{localappdata}\Programs\DerinTaramaAsistan"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- Opsiyonel: Tauri NSIS (varsa sessiz kur) ---
Source: "staging\votex-setup.exe"; DestDir: "{tmp}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\VOTEX"; Filename: "{localappdata}\Programs\VOTEX\Votex.exe"; WorkingDir: "{localappdata}\Programs\VOTEX"
Name: "{group}\Derin Tarama Asistan"; Filename: "{localappdata}\Programs\DerinTaramaAsistan\baslat.vbs"; WorkingDir: "{localappdata}\Programs\DerinTaramaAsistan"
Name: "{autodesktop}\VOTEX"; Filename: "{localappdata}\Programs\VOTEX\Votex.exe"; Tasks: desktopicon
Name: "{autodesktop}\Derin Tarama Asistan"; Filename: "{localappdata}\Programs\DerinTaramaAsistan\baslat.vbs"; Tasks: desktopicon

[Run]
; VC++
Filename: "{tmp}\dft_runtimes\VC_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "VC++ kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; WebView2
Filename: "{tmp}\dft_runtimes\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "WebView2 kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; Node.js (VOTEX)
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\dft_runtimes\node-lts-x64.msi"" /qn /norestart"; StatusMsg: "Node.js kuruluyor (VOTEX)…"; Flags: waituntilterminated skipifdoesntexist

; Rust (VOTEX)
Filename: "{tmp}\dft_runtimes\rustup-init.exe"; Parameters: "-y --default-toolchain stable"; StatusMsg: "Rust kuruluyor (VOTEX)…"; Flags: waituntilterminated skipifdoesntexist

; Tauri NSIS varsa sessiz
Filename: "{tmp}\votex-setup.exe"; Parameters: "/S"; StatusMsg: "VOTEX kuruluyor…"; Flags: waituntilterminated skipifdoesntexist

; Ayar yaz
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\dft_runtimes\write_settings.ps1"""; StatusMsg: "Ayarlar…"; Flags: waituntilterminated skipifdoesntexist runhidden

; DTA paketleri gömülü Python'a (venv yok) — VoteX'e dokunmaz
Filename: "{localappdata}\Programs\DerinTaramaAsistan\runtime\python312-amd64\python.exe"; Parameters: """{localappdata}\Programs\DerinTaramaAsistan\launcher.py"" --silent-setup"; WorkingDir: "{localappdata}\Programs\DerinTaramaAsistan"; StatusMsg: "Derin Tarama Asistan hazırlanıyor…"; Flags: waituntilterminated skipifdoesntexist

Filename: "{localappdata}\Programs\VOTEX\Votex.exe"; Description: "VOTEX'i aç"; Flags: nowait postinstall skipifsilent skipifdoesntexist

[Code]
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

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  VotexUninstaller: String;
  SuiteUninstaller: String;
begin
  Result := '';
  NeedsRestart := False;

  { Sadece VOTEX sürecini kapat; kullanıcı verilerine dokunma. }
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM Votex.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Önce Tauri'nin kendi kaldırıcısı, ardından birleşik DFT Suite kaldırıcısı. }
  VotexUninstaller := ExpandConstant('{localappdata}\Programs\VOTEX\uninstall.exe');
  SuiteUninstaller := ExpandConstant('{localappdata}\Programs\DFT_Suite\unins000.exe');

  if not RunSilentUninstaller(VotexUninstaller, '/S') then
  begin
    Result := 'Mevcut VOTEX kaldırma işlemi başarısız oldu. Yeni kurulum durduruldu.';
    exit;
  end;

  if not RunSilentUninstaller(SuiteUninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART') then
  begin
    Result := 'Mevcut DFT Suite kaldırma işlemi başarısız oldu. Yeni kurulum durduruldu.';
    exit;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
end;
