-- macOS: read UTF-8 payload, place on clipboard, paste via System Events (requires Accessibility permission for the app launching osascript — grant to Jarvis / Electron).
on run argv
	if (count of argv) < 1 then error "missing payload path"
	set payloadPath to item 1 of argv
	set memContext to do shell script "cat " & quoted form of payloadPath
	set the clipboard to memContext
	tell application "System Events"
		keystroke "v" using command down
	end tell
end run
