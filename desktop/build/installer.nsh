; War Room OS NSIS extras — preserve AppData by default (deleteAppDataOnUninstall=false).
; AUTO_START_WITH_WINDOWS = OFF (no startup registry entry).
!macro customInstall
  ; no-op: shortcuts created by electron-builder nsis flags
!macroend

!macro customUnInstall
  ; Intentionally do NOT remove %LOCALAPPDATA%\War Room OS
!macroend
