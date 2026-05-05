; Demote diagnostics so -WX / warnings-as-errors does not fail the build (NSIS has no "error off" subcommand).
!pragma warning warning all
!pragma warning disable 6000

; Jarvis NSIS hooks (included by electron-builder).
; Uses inetc (bundled with electron-builder NSIS).

!macro customInstall
  DetailPrint 'Installing Jarvis...'
  DetailPrint 'Extracting Ollama bootstrap script...'
  SetOverwrite on
  File "/oname=$PLUGINSDIR\ollama-bootstrap.ps1" "${BUILD_RESOURCES_DIR}\ollama-bootstrap.ps1"

  DetailPrint 'Checking for Ollama (Program Files)...'
  StrCpy $R8 0
  ${If} ${FileExists} "$PROGRAMFILES64\Ollama\ollama.exe"
    StrCpy $R8 1
  ${EndIf}

  ${If} $R8 == 0
    DetailPrint 'Checking for Ollama (Local AppData)...'
    ExpandEnvStrings $R9 %LOCALAPPDATA%
    ${If} ${FileExists} "$R9\Programs\Ollama\ollama.exe"
      StrCpy $R8 1
    ${EndIf}
  ${EndIf}

  ${If} $R8 == 0
    DetailPrint 'Ollama not found. Downloading OllamaSetup.exe...'
    inetc::get /NOPROXY /USERAGENT "JarvisSetup/1.0 (electron-builder)" /RESUME "" "https://ollama.com/download/OllamaSetup.exe" "$PLUGINSDIR\OllamaSetup.exe" /END
    Pop $R6
    ${If} $R6 != "OK"
      MessageBox MB_ICONSTOP "Could not download Ollama ($R6). Check your internet connection and try again."
      Abort
    ${EndIf}
    DetailPrint 'Running Ollama installer silently...'
    ClearErrors
    ExecWait '"$PLUGINSDIR\OllamaSetup.exe" /S' $R6
    ${If} ${Errors}
      MessageBox MB_ICONSTOP "Could not run the Ollama installer."
      Abort
    ${EndIf}
    ${If} $R6 != 0
      MessageBox MB_ICONSTOP "Ollama setup exited with code $R6."
      Abort
    ${EndIf}
  ${Else}
    DetailPrint 'Ollama is already installed.'
  ${EndIf}

  DetailPrint 'Running Ollama bootstrap (model setup)...'
  ClearErrors
  ExecWait '"powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\ollama-bootstrap.ps1"' $R6
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "Could not start the AI model download."
    Abort
  ${EndIf}
  ${If} $R6 != 0
    MessageBox MB_ICONSTOP "AI model setup failed (exit code $R6). Ensure Ollama is working and try again."
    Abort
  ${EndIf}

  DetailPrint 'Adding Jarvis to Windows startup (current user)...'
  StrCpy $R9 "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}" $R9

  DetailPrint 'Jarvis post-install steps finished.'
!macroend

!macro customUnInstall
  DetailPrint 'Removing Jarvis from Windows startup (current user)...'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
!macroend
