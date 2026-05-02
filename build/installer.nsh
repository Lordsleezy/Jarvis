!pragma warning warning all
!pragma warning disable 6000

!macro customInstall
  DetailPrint 'Installing Jarvis'
  SetOverwrite on
  File "/oname=$PLUGINSDIR\ollama-bootstrap.ps1" "${BUILD_RESOURCES_DIR}\ollama-bootstrap.ps1"
  StrCpy $R8 0
  ${If} ${FileExists} "$PROGRAMFILES64\Ollama\ollama.exe"
    StrCpy $R8 1
  ${EndIf}
  ${If} $R8 == 0
    ExpandEnvStrings $R9 %LOCALAPPDATA%
    ${If} ${FileExists} "$R9\Programs\Ollama\ollama.exe"
      StrCpy $R8 1
    ${EndIf}
  ${EndIf}
  ${If} $R8 == 0
    DetailPrint 'Downloading Ollama'
    inetc::get /NOPROXY /RESUME "" "https://ollama.com/download/OllamaSetup.exe" "$PLUGINSDIR\OllamaSetup.exe" /END
    Pop $R6
    ExecWait '"$PLUGINSDIR\OllamaSetup.exe" /S' $R6
  ${EndIf}
  DetailPrint 'Setting up AI model'
  ExecWait '"powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\ollama-bootstrap.ps1"' $R6
  DetailPrint 'Finishing up'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\""
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
!macroend
