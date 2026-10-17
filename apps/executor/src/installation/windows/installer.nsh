; /**
;  * @author Codex
;  * @description Registers only this user's fixed Browser Host, refuses active upgrades without killing processes and preserves user data on uninstall.
;  */
!macro customCheckAppRunning
  ; Inspect only; never kill an active application or its private adapters to permit an update.
  System::Call 'kernel32::SetEnvironmentVariableW(w "OCTOPUS_INSTALL_DIR", w "$INSTDIR") i .r0'
  System::Call 'kernel32::GetCurrentProcessId() i .r1'
  System::Call 'kernel32::SetEnvironmentVariableW(w "OCTOPUS_INSTALL_PID", w "$1")'
  nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -Command "try { if (@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.ProcessId -ne [int]$$env:OCTOPUS_INSTALL_PID -and ($$_.Name -eq $\'Dr.Octopus Executor.exe$\' -or ($$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$env:OCTOPUS_INSTALL_DIR + $\'\$\', [StringComparison]::OrdinalIgnoreCase))) }).Count -gt 0) { exit 1 }; exit 0 } catch { exit 2 }"'
  Pop $0
  Pop $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "OCTOPUS_INSTALL_DIR", p 0)'
  System::Call 'kernel32::SetEnvironmentVariableW(w "OCTOPUS_INSTALL_PID", p 0)'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Exit Dr.Octopus Executor completely from its tray and stop this installation's private adapters before upgrading or uninstalling. Process inspection must also succeed. No processes were terminated." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

!macro customInstall
  CreateDirectory "$PROFILE\.dr-octopus\executor"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\executor\setup\register-browser-host.ps1" -Mode install -ResourceRoot "$INSTDIR\resources\executor" -ProjectRoot "$PROFILE\.dr-octopus\executor" -MigrateProduct'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Browser Host registration failed (exit $0)."
    DetailPrint "$1"
    Push $2
    Push $3
    Push $4
    ClearErrors
    GetTempFileName $2 "$TEMP"
    ${IfNot} ${Errors}
      ClearErrors
      Rename "$2" "$2.txt"
      ${IfNot} ${Errors}
        StrCpy $2 "$2.txt"
      ${EndIf}
      ClearErrors
      FileOpen $3 "$2" w
      ${IfNot} ${Errors}
        FileWriteUTF16LE /BOM $3 "Browser Host registration failed.$\r$\nExit code: $0$\r$\nResource root: $INSTDIR\resources\executor$\r$\nProject root: $PROFILE\.dr-octopus\executor$\r$\n$\r$\n$1$\r$\n"
        FileClose $3
      ${Else}
        StrCpy $2 "unavailable; see installer Details"
      ${EndIf}
    ${Else}
      StrCpy $2 "unavailable; see installer Details"
    ${EndIf}
    StrCpy $4 $1 350
    MessageBox MB_ICONSTOP "Browser Host registration failed (exit $0). Program files may already have changed; this is not a transactional rollback. Foreign registrations and user data are preserved.$\r$\n$\r$\nDiagnostic log: $2$\r$\n$\r$\n$4$\r$\n$\r$\nKeep the old package and data backup and follow the included recovery guide." /SD IDOK
    Pop $4
    Pop $3
    Pop $2
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\executor\setup\register-browser-host.ps1" -Mode remove -ResourceRoot "$INSTDIR\resources\executor" -ProjectRoot "$PROFILE\.dr-octopus\executor" -MigrateProduct'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Browser Host removal failed (exit $0)."
    DetailPrint "$1"
    MessageBox MB_ICONEXCLAMATION "Browser Host removal failed or the registration belongs to another installation. User data and foreign registrations are preserved." /SD IDOK
  ${EndIf}
!macroend
