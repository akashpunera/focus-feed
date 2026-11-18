# Focus Feed for Safari

Focus Feed adds local 👍 and 👎 controls to the X and YouTube Home feeds. After you vote, choose a style, edit the reason, and select **Save preference**. The toolbar popup lets you edit or undo votes, review cards hidden by your preferences, and set how much room to leave for discovery.

## Run the development build

1. Run `./mac/build.sh` and open **Focus Feed.app** from the output directory printed by the script.
2. In Safari, open **Settings → Extensions** and enable **Focus Feed**. This local build uses an ad-hoc signature. If Safari does not list it, turn on **Show features for web developers** in Safari’s **Advanced** settings, then select **Allow unsigned extensions** in **Developer** settings. Safari may require you to re-enable this on relaunch.
3. Allow Focus Feed on **x.com** and **www.youtube.com** when prompted. Reload the Home pages to see the voting controls.

On Safari versions with **Add Temporary Extension** in the Developer settings pane, you can also select the `extension` folder from this repository. See [Apple’s setup instructions](https://developer.apple.com/documentation/safariservices/building-and-testing-a-safari-web-extension).

## Filtering behavior

- On YouTube watch pages, Focus Feed blocks requests to a known ad endpoint and covers and mutes detected playback ads. It clicks YouTube’s Skip button as soon as it becomes available. Unskippable ads may still delay playback, and server-inserted ads can escape detection. Creator sponsorships are part of the video.

- Recognizable Home-feed ads, sponsored labels, platform warnings, and explicit text signals are hidden before applying personal preferences. Filtering is limited by the signals the sites expose. Unlabeled imagery, video content, and sponsorships embedded in videos may still appear.
- Confirmed dislikes hide the specific card. Supported style reasons teach the filter across creators and platforms. Enter exact words in quotes to match that phrase elsewhere. Other free-form reasons are kept with the saved preference.
- Discovery lets a share of softer matches through. Turn on **Prioritize posts like my likes** to favor liked styles while keeping a sample of unfamiliar cards. It takes effect after you add a positive preference with a style, a quoted phrase, or enough text to compare.
- Votes and settings are kept in Safari’s local extension storage. The extension does not send your feedback to X, YouTube, or a cloud service.

## Build and test from source

Use macOS Command Line Tools for the app build and Node.js with pnpm for the fixture suite.

```sh
./mac/build.sh
pnpm install --frozen-lockfile
pnpm test
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc extension/policy.js tests/policy.js
```

The policy suite covers filtering, style transfer, positive preference matching, discovery, and undo. The DOM fixtures exercise both Home adapters and the save, edit, review, and undo flow with simulated extension storage. The packaged manifest can also be checked through the WebKit extension loader on macOS 15.4 or later using `tests/manifest.m`.

## Contributing

Open an issue for bugs or feature ideas. For code changes, include the Safari and macOS versions, the affected site, and a synthetic regression fixture when possible. Keep account details, private feed content, and saved reasons out of public issues and test data. Run the tests above before opening a pull request.

## Security and privacy

This is a development build. The local app uses an ad-hoc signature. The current in-page vote form shares the page DOM with the host site, so avoid entering confidential reasons. See [SECURITY.md](SECURITY.md).
