#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
destination="${1:-$(mktemp -d /tmp/focus-feed-build.XXXXXX)}"
mkdir -p "$destination"
destination="$(cd "$destination" && pwd)"
app="$destination/Focus Feed.app"
extension="$app/Contents/PlugIns/Focus Feed.appex"
mkdir -p "$app/Contents/MacOS" "$extension/Contents/MacOS" "$extension/Contents/Resources"

python3 - "$app" "$extension" <<'PY'
import pathlib, plistlib, sys

def write(bundle, identifier, executable, package, extra):
    info = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleIdentifier": identifier,
        "CFBundleExecutable": executable,
        "CFBundleName": "Focus Feed",
        "CFBundleDisplayName": "Focus Feed",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundlePackageType": package,
        "CFBundleShortVersionString": "1.1.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "13.0",
    }
    with (pathlib.Path(bundle) / "Contents/Info.plist").open("wb") as out:
        plistlib.dump(info | extra, out)

write(sys.argv[1], "app.focusfeed.local", "FocusFeed", "APPL", {"NSPrincipalClass": "NSApplication"})
write(sys.argv[2], "app.focusfeed.local.extension", "FocusFeedExtension", "XPC!", {
    "NSExtension": {
        "NSExtensionPointIdentifier": "com.apple.Safari.web-extension",
        "NSExtensionPrincipalClass": "SafariWebExtensionHandler",
    }
})
PY
cp -X extension/* "$extension/Contents/Resources/"
arch="$(uname -m)"
xcrun swiftc -module-cache-path "$PWD/.module-cache" -target "$arch-apple-macos13.0" mac/App.swift -o "$app/Contents/MacOS/FocusFeed"
cat > "$destination/extension-entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>
PLIST
xcrun swiftc -module-cache-path "$PWD/.module-cache" -target "$arch-apple-macos13.0" mac/Extension.swift -Xlinker -e -Xlinker _NSExtensionMain -o "$extension/Contents/MacOS/FocusFeedExtension"
codesign --force --sign - --entitlements "$destination/extension-entitlements.plist" "$extension"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
printf "\nBuilt %s\n" "$app"
