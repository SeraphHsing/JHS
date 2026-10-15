# Representative UI fixture dependencies

Toastify 1.12.0 and Viewer.js 1.11.1 match the userscript's pinned runtime versions.
The accompanying upstream license files apply. These local files let visual tests
render the actual feedback components without external requests or production data.

Bulma 0.9.4 and Bootstrap 3.4.1 are representative host frameworks for compatibility
rendering. They do not establish the current stylesheets served by JavDB or JavBus.
Their licenses are included. Existing functional/startup fixtures remain unchanged;
host styles and real feedback are explicitly enabled by visual tests only.

Downloaded from the npm registry packages at these exact versions on 2026-10-04.
