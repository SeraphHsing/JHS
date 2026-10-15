# Native JavDB recommendation fixture

Observed in logged-in Chrome on 2026-10-06 at `https://javdb.com/v/Ywz40D`, while Dev `7.0.0-dev.202610050507` was installed.

Both “TA(们)还出演过” and “你可能也喜欢” used `article.message.video-panel > .message-body > .tile-images.tile-small`, with nine `a.tile-item` children containing an image, `.video-number`, and `.video-title`. The screenshot gallery separately used `.tile-images.preview-images`.

`javdb-detail-native-tiles.html` reproduces that nesting without account data or remote movie media; images and titles are synthetic. `javdb-app-11569924.css` is the unmodified stylesheet loaded by that page, exported through the browser page-assets capability from `https://javdb.com/packs/css/app-11569924.css`.

CSS SHA256: `E31474AB18F1BA373D7FAFD97335BD8BA5FFDEE310CE853064081E5DF918163B`.

This fixture supersedes the earlier `.movie-list`-only recommendation coverage. It verifies the observed host structure; it does not establish that a newly built userscript is installed in the user's browser.
