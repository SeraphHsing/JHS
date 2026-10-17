// @ts-check

import { LifecycleScope } from "../../core/lifecycle-scope.js";
import { DETAIL_SHORTCUT_ACTIONS, readDetailShortcuts, shortcutAriaLabel, shortcutFromEvent, shortcutLabel, shortcutMatches } from "../../core/detail-shortcuts.js";

export const DETAIL_SHORTCUT_STYLES = `.jhs-shortcut-hint { font:inherit; font-size:.85em; min-width:0; white-space:normal; overflow-wrap:anywhere; }`;
const OVERLAYS = '.layui-layer,[role="dialog"],[aria-modal="true"],.viewer-container,.fancybox-container,.bus-preview-modal,.jhs-owned-popover.is-open,[role="menu"],.loading-container';

/** Visibility includes ancestors; detached/hidden reusable overlays never own keys. @param {Element} element */
export function shortcutElementVisible(element) {
    if (!element.isConnected) return false;
    for (let current = /** @type {Element | null} */ (element); current; current = current.parentElement) {
        const style = current.ownerDocument.defaultView?.getComputedStyle(current);
        if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" || current.hasAttribute("inert") || style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
    }
    return true;
}

/** @param {Element} element */
function stackingLevel(element) {
    let level = 0;
    for (let current = /** @type {Element | null} */ (element); current; current = current.parentElement) {
        level = Math.max(level, Number(current.ownerDocument.defaultView?.getComputedStyle(current).zIndex) || 0);
    }
    return level;
}

/** Exempt the detail's own layer and its ancestors, never a child modal. @param {Element} target */
function surfaceUnobscured(target) {
    if (!shortcutElementVisible(target)) return false;
    const owner = target.closest('.layui-layer,[role="dialog"],[aria-modal="true"]');
    return ![...target.ownerDocument.querySelectorAll(OVERLAYS)].some(overlay => {
        if (overlay === owner || overlay.contains(target) || !shortcutElementVisible(overlay)) return false;
        if (!owner || owner.contains(overlay)) return true;
        const difference = stackingLevel(overlay) - stackingLevel(owner);
        return difference > 0 || (difference === 0 && !!(owner.compareDocumentPosition(overlay) & 4));
    });
}

/** One instance owns only its mounted action root, including FC2 roots on a list page. */
export class DetailShortcutController {
    /** @param {{root: Element, settings: any, scope: LifecycleScope, isActive?: () => boolean}} options */
    constructor(options) {
        this.root = options.root;
        this.document = this.root.ownerDocument;
        this.settings = options.settings;
        this.ownerAlive = options.isActive ?? (() => true);
        this.scope = new LifecycleScope("detail-shortcuts");
        this.releaseOwner = options.scope.addCleanup(() => this.dispose());
    }

    start() {
        if (!this.active()) return false;
        this.render();
        this.scope.listen(this.settings, "settings.changed", () => this.render());
        this.scope.listen(this.document, "keydown", event => this.onKeydown(/** @type {KeyboardEvent} */ (event)));
        this.scope.addCleanup(() => {
            for (const button of this.root.querySelectorAll("[aria-keyshortcuts]")) button.removeAttribute("aria-keyshortcuts");
            for (const hint of this.root.querySelectorAll(".jhs-shortcut-hint")) hint.remove();
        });
        return true;
    }

    active() { return !this.scope.disposed && this.ownerAlive() && this.root.isConnected; }

    canHandle() {
        if (!this.active() || this.document.fullscreenElement || !surfaceUnobscured(this.root)) return false;
        try {
            let frame = this.document.defaultView?.frameElement;
            while (frame) {
                if (!surfaceUnobscured(frame) || frame.ownerDocument.fullscreenElement) return false;
                frame = frame.ownerDocument.defaultView?.frameElement;
            }
        } catch { return false; }
        return true;
    }

    render() {
        if (!this.active()) return;
        const shortcuts = readDetailShortcuts(this.settings.snapshot().detailShortcuts);
        for (const [key, action] of Object.entries(DETAIL_SHORTCUT_ACTIONS)) {
            const button = this.root.querySelector(`#${action.id}`);
            if (!button) continue;
            button.querySelector(".jhs-shortcut-hint")?.remove();
            button.removeAttribute("aria-keyshortcuts");
            const shortcut = shortcuts[/** @type {keyof typeof DETAIL_SHORTCUT_ACTIONS} */ (key)];
            if (!shortcut) continue;
            const hint = this.document.createElement("kbd");
            hint.className = "jhs-shortcut-hint";
            for (const [index, part] of shortcutLabel(shortcut).split("+").entries()) {
                if (index) hint.append("+", this.document.createElement("wbr"));
                hint.append(part);
            }
            button.append(hint);
            button.setAttribute("aria-keyshortcuts", shortcutAriaLabel(shortcut));
        }
    }

    /** @param {KeyboardEvent} event */
    onKeydown(event) {
        if (event.defaultPrevented) return;
        const pressed = shortcutFromEvent(event);
        if (!pressed) return;
        const shortcuts = readDetailShortcuts(this.settings.snapshot().detailShortcuts);
        const matches = Object.entries(DETAIL_SHORTCUT_ACTIONS).filter(([key]) => shortcutMatches(shortcuts[/** @type {keyof typeof DETAIL_SHORTCUT_ACTIONS} */ (key)], pressed));
        if (matches.length !== 1) return;
        const nodes = [...event.composedPath(), this.document.activeElement];
        if (nodes.some(node => node && "nodeType" in node && node.nodeType === 1 && /** @type {Element} */ (node).closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],video,audio'))) return;
        if (["Enter", "NumpadEnter", "Space"].includes(pressed.code) && nodes.some(node => node && "nodeType" in node && node.nodeType === 1 && /** @type {Element} */ (node).closest('button,a[href],[role="button"],[role="link"]'))) return;
        if (!this.canHandle()) return;
        const button = /** @type {HTMLButtonElement | null} */ (this.root.querySelector(`#${matches[0][1].id}`));
        if (!button || button.tagName !== "BUTTON" || button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("aria-busy") === "true" || !button.hasAttribute("aria-pressed") || !shortcutElementVisible(button)) return;
        event.preventDefault();
        button.click();
    }

    /** Focus only the current owned detail frame once, after initial mounting settles. @param {any} events */
    prepareFrameFocus(events) {
        const view = this.document.defaultView;
        if (!view || view.parent === view) return;
        try {
            const frame = view.frameElement;
            if (!frame?.closest(".jhs-dialog,.movie-detail-layer")) return;
            const parentDocument = frame.ownerDocument, initialFocus = parentDocument.activeElement;
            const owner = frame.closest(".jhs-dialog,.movie-detail-layer");
            if (initialFocus && initialFocus !== parentDocument.body && !owner?.contains(initialFocus)) return;
            const focusScope = new LifecycleScope("detail-shortcuts-focus");
            const release = this.scope.addCleanup(() => focusScope.dispose());
            let interacted = false;
            for (const type of ["pointerdown", "keydown", "focusin"]) focusScope.listen(parentDocument, type, () => { interacted = true; }, true);
            const focus = () => {
                if (!interacted && parentDocument.activeElement === initialFocus && this.canHandle() && Object.keys(readDetailShortcuts(this.settings.snapshot().detailShortcuts)).length) view.focus();
                release();
            };
            if (events?.on) focusScope.addCleanup(events.on("jhs-features-ready", focus));
            else queueMicrotask(() => { if (!focusScope.disposed) focus(); });
        } catch { /* Cross-origin parents retain their own focus policy. */ }
    }

    dispose() { this.scope.dispose(); this.releaseOwner(); }
}
