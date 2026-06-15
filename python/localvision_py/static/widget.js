// Placeholder for the bundled widget JS.
//
// Run `cd python && npm install && npm run build` to produce the real
// bundle from `widget-src/index.ts`. The build emits to this same path
// (`python/localvision_py/static/widget.js`) and overwrites this stub.
//
// We commit this stub so editable installs (`pip install -e .`) don't
// fail on the missing file before the user has run the build.

export default {
    render({ el }) {
        el.innerHTML =
            '<div style="padding:24px;background:#1A1D27;color:#F0F2FF;font-family:sans-serif;border-radius:8px;">' +
            '<strong>LocalVision widget bundle not built yet.</strong><br><br>' +
            'From the project root: <code>cd python &amp;&amp; npm install &amp;&amp; npm run build</code>' +
            '</div>';
        return () => { el.innerHTML = ''; };
    },
};
