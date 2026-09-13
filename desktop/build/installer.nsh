; War Room OS NSIS extras — preserve AppData by default (deleteAppDataOnUninstall=false).
; AUTO_START_WITH_WINDOWS = OFF (no startup registry entry).
;
; Canonical per-user install directory is quoted inside this script:
;   $LOCALAPPDATA\Programs\War Room OS
; Passing /D= with an unquoted path that contains spaces truncates to Programs\War.
; Silent install must use /S only — do not pass /D=.

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\War Room OS"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\War Room OS"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\War Room OS"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\War Room OS"
!macroend

!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\War Room OS"
!macroend

!macro customInstall
  ; no-op: shortcuts created by electron-builder nsis flags
!macroend

!macro customUnInstall
  ; Intentionally do NOT remove %LOCALAPPDATA%\War Room OS
!macroend
