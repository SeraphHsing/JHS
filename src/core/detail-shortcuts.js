// @ts-check

/** @typedef {{code: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean}} DetailShortcut */
export const DETAIL_SHORTCUT_ACTIONS = Object.freeze({
    blocked: { id: "filterBtn", label: "屏蔽" },
    favorite: { id: "favoriteBtn", label: "收藏" },
    downloaded: { id: "hasDownBtn", label: "已下载" },
    watched: { id: "hasWatchBtn", label: "已观看" },
});

/** @param {unknown} value @returns {DetailShortcut | null} */
function normalizeShortcut(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = /** @type {Record<string, unknown>} */ (value);
    if (typeof item.code !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(item.code) || /^(Control|Shift|Alt|Meta)/.test(item.code) || ["Escape", "Tab", "Unidentified"].includes(item.code)) return null;
    const modifiers = ["ctrl", "alt", "shift", "meta"];
    if (modifiers.some(key => item[key] !== undefined && typeof item[key] !== "boolean")) return null;
    return { code: item.code, ctrl: item.ctrl === true, alt: item.alt === true, shift: item.shift === true, meta: item.meta === true };
}

/** @param {KeyboardEvent} event */
export function shortcutFromEvent(event) {
    if (event.isComposing || event.repeat || event.keyCode === 229) return null;
    return normalizeShortcut({ code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
}

/** @param {DetailShortcut | undefined | null} shortcut */
export function shortcutLabel(shortcut) {
    if (!shortcut) return "";
    const key = shortcut.code.replace(/^Key(?=[A-Z]$)|^Digit(?=\d$)/g, "");
    return [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", key === "Space" ? "空格" : key].filter(Boolean).join("+");
}

/** @param {DetailShortcut | undefined | null} shortcut */
export function shortcutAriaLabel(shortcut) {
    return shortcut ? [shortcut.ctrl && "Control", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", shortcut.code.replace(/^Key(?=[A-Z]$)|^Digit(?=\d$)/g, "")].filter(Boolean).join("+") : "";
}

/** @param {DetailShortcut | undefined | null} left @param {DetailShortcut | undefined | null} right */
export function shortcutMatches(left, right) {
    return !!left && !!right && left.code === right.code && left.ctrl === right.ctrl && left.alt === right.alt && left.shift === right.shift && left.meta === right.meta;
}

/** @param {unknown} value @returns {Partial<Record<keyof typeof DETAIL_SHORTCUT_ACTIONS, DetailShortcut>>} */
export function readDetailShortcuts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result = /** @type {Partial<Record<keyof typeof DETAIL_SHORTCUT_ACTIONS, DetailShortcut>>} */ ({});
    for (const key of /** @type {(keyof typeof DETAIL_SHORTCUT_ACTIONS)[]} */ (Object.keys(DETAIL_SHORTCUT_ACTIONS))) {
        const normalized = normalizeShortcut(/** @type {Record<string, unknown>} */ (value)[key]);
        if (normalized) result[key] = normalized;
    }
    return result;
}
