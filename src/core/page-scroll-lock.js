// @ts-check

/** @type {WeakMap<Document, {tokens: Set<object>, restore: () => void}>} */
const locks = new WeakMap();

/** Save individual declarations without reverting unrelated inline changes. @param {HTMLElement} element @param {string[]} properties */
function saveStyle(element, properties) {
    const saved = properties.map(name => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }));
    return () => saved.forEach(({ name, value, priority }) => {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
    });
}

/** Acquire a document lock; each owner receives an independent, idempotent release. @param {Node} owner */
export function acquirePageScrollLock(owner) {
    const doc = owner.nodeType === 9 ? /** @type {Document} */ (owner) : owner.ownerDocument;
    if (!doc?.body || !doc.defaultView) return () => {};
    let state = locks.get(doc);
    if (!state) {
        const root = doc.documentElement, body = doc.body, view = doc.defaultView;
        const restoreRoot = saveStyle(root, ["overflow", "overflow-x", "overflow-y", "scrollbar-gutter"]);
        const restoreBody = saveStyle(body, ["overflow", "overflow-x", "overflow-y", "padding-inline-end"]);
        const width = root.clientWidth > 0 ? Math.max(0, view.innerWidth - root.clientWidth) : 0;
        if (width > 0) {
            if (view.CSS?.supports?.("scrollbar-gutter", "stable")) {
                if (!view.getComputedStyle(root).scrollbarGutter.includes("stable")) root.style.setProperty("scrollbar-gutter", "stable", "important");
            } else {
                const style = view.getComputedStyle(body), padding = parseFloat(style.paddingInlineEnd || (style.direction === "rtl" ? style.paddingLeft : style.paddingRight)) || 0;
                body.style.setProperty("padding-inline-end", `${padding + width}px`, "important");
            }
        }
        root.style.setProperty("overflow", "hidden", "important");
        body.style.setProperty("overflow", "hidden", "important");
        state = { tokens: new Set(), restore: () => { restoreBody(); restoreRoot(); } };
        locks.set(doc, state);
    }
    const token = {};
    state.tokens.add(token);
    return () => {
        if (!state.tokens.delete(token) || state.tokens.size) return;
        state.restore();
        locks.delete(doc);
    };
}
