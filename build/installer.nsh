; Jarvis NSIS hooks (included by electron-builder).
; Prerequisites: inetc + WinShell + System plugins from electron-builder NSIS bundle.

!macro JARVIS_SET_STATUS
  ${IfNot} ${Silent}
    FindWindow $R0 "#32770" "" $hwndparent
    FindWindow $R0 "#32770" "" $hwndparent $R0
    GetDlgItem $R0 $R0 1000
    System::Call 'user32::SetWindowTextW(p r0, w R7)'
  ${EndIf}
  DetailPrint $R7
!macroend

!macro customInstall
  ; SpiderBanner line during file extraction uses electron-builder's built-in "installing" LangString; custom steps use the messages below.
  StrCpy $R7 "Installing Jarvis"
  !insertmacro JARVIS_SET_STATUS

  StrCpy $R7 "Setting up AI brain"
  !insertmacro JARVIS_SET_STATUS

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
    inetc::get /NOPROXY /USERAGENT "JarvisSetup/1.0 (electron-builder)" /RESUME "" "https://ollama.com/download/OllamaSetup.exe" "$PLUGINSDIR\OllamaSetup.exe" /END
    Pop $R6
    ${If} $R6 != "OK"
      MessageBox MB_ICONSTOP "Could not download Ollama ($R6). Check your internet connection and try again."
      Abort
    ${EndIf}
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
  ${EndIf}

  StrCpy $R7 "Downloading Llama 3 model"
  !insertmacro JARVIS_SET_STATUS

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

  StrCpy $R7 "Creating shortcuts"
  !insertmacro JARVIS_SET_STATUS
  ${If} ${FileExists} "$newDesktopLink"
    ; Desktop / Start Menu links were created earlier in the section; refresh shell icons.
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

  StrCpy $R7 "Finishing up"
  !insertmacro JARVIS_SET_STATUS

  StrCpy $R9 "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}" $R9
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
!macroend
