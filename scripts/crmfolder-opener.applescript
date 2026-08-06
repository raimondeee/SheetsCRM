-- SheetsCRM custom URL handler for crmfolder:// paths.
-- Installed by scripts/install-crmfolder-helper.sh into
-- ~/Library/Application Support/SheetsCRM/SheetsCRM Folder Opener.app

on open location inputUrl
	try
		set folderPath to my pathFromCrmFolderUrl(inputUrl as text)
		if folderPath is "" then error "Missing folder path in crmfolder:// link."
		do shell script "/bin/mkdir -p " & quoted form of folderPath & " && /usr/bin/open " & quoted form of folderPath
	on error errMsg number errNum
		display alert "SheetsCRM Folder Opener" message (errMsg as text) as critical
	end try
end open location

on pathFromCrmFolderUrl(rawUrl)
	set u to rawUrl
	if u starts with "crmfolder://" then
		set u to text 13 thru -1 of u
	else if u starts with "crmfolder:" then
		set u to text 11 thru -1 of u
	end if
	-- Percent-decode (e.g. Row%2042 → Row 42)
	return do shell script "/usr/bin/python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' " & quoted form of u
end pathFromCrmFolderUrl

-- Silent no-op so install/launch for Launch Services registration shows no UI.
on run
end run
