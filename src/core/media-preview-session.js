// @ts-check
import { LifecycleScope } from "./lifecycle-scope.js";

/** Readiness waits belong to the view session, never to a detached/global video ID. */
export class MediaPreviewSession {
    constructor() {
        this.scope = new LifecycleScope("media-preview");
        this.revision = 0;
    }
    dispose() { this.revision++; this.scope.dispose(); }
    /** @param {HTMLVideoElement} video @param {number} [timeout] */
    waitReady(video, timeout = 4000) { return waitForPreviewReady(video, this.scope, timeout); }
}

/** @param {HTMLVideoElement} video @param {LifecycleScope} scope @param {number} [timeout] */
export function waitForPreviewReady(video, scope, timeout = 4000) {
    if (scope.disposed || video.error) return Promise.resolve(false);
    if (video.readyState >= 2) return Promise.resolve(true);
    return new Promise(resolve => {
        let done = false;
        /** @type {(() => void) | undefined} */ let release;
        const finish = (/** @type {boolean} */ ready) => {
            if (done) return; done = true;
            clearTimeout(timer); video.removeEventListener("canplay", success); video.removeEventListener("loadeddata", success); video.removeEventListener("error", failure); release?.(); resolve(ready);
        };
        const success = () => finish(true), failure = () => finish(false), timer = setTimeout(failure, timeout);
        video.addEventListener("canplay", success); video.addEventListener("loadeddata", success); video.addEventListener("error", failure);
        release = scope.addCleanup(failure);
    });
}
