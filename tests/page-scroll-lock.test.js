// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquirePageScrollLock } from "../src/core/page-scroll-lock.js";
import { enhanceDialogButtons, prepareDialogOptions } from "../src/core/dialog-shell.js";

afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute("style"); document.body.removeAttribute("style"); document.body.replaceChildren(); });
function classicScrollbar(supports = true) {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth - 17);
    Object.defineProperty(window, "CSS", { configurable: true, value: { supports: () => supports } });
}
describe("page scroll ownership", () => {
    it("retains the lock until its final owner and ignores repeated late releases", () => {
        classicScrollbar();
        const a = acquirePageScrollLock(document), b = acquirePageScrollLock(document.body);
        expect(document.documentElement.style.overflow).toBe("hidden");
        expect(document.documentElement.style.scrollbarGutter).toBe("stable");
        expect(document.body.style.paddingInlineEnd).toBe("");
        a(); a();
        expect(document.body.style.overflow).toBe("hidden");
        b();
        expect(document.body.style.overflow).toBe("");
        const c = acquirePageScrollLock(document); a(); b();
        expect(document.body.style.overflow).toBe("hidden");
        c();
    });
    it("restores declarations and priorities while preserving unrelated changes", () => {
        classicScrollbar();
        document.documentElement.style.cssText = "overflow:scroll!important;overflow-x:auto;scrollbar-gutter:stable both-edges!important;color:red";
        document.body.style.cssText = "overflow-y:scroll!important;padding-inline-end:9px!important";
        const root = document.documentElement.style.cssText, body = document.body.style.cssText;
        const release = acquirePageScrollLock(document);
        document.documentElement.style.color = "blue";
        release();
        expect(document.documentElement.style.cssText).toBe(root.replace("red", "blue"));
        expect(document.body.style.cssText).toBe(body);
    });
    it("compensates only once when stable gutters are unsupported", () => {
        classicScrollbar(false);
        document.body.style.paddingInlineEnd = "8px";
        const first = acquirePageScrollLock(document), second = acquirePageScrollLock(document);
        expect(document.body.style.paddingInlineEnd).toBe("25px");
        second();
        expect(document.body.style.paddingInlineEnd).toBe("25px");
        first();
        expect(document.body.style.paddingInlineEnd).toBe("8px");
    });
    it("does not invent padding on overlay scrollbar platforms", () => {
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth);
        const release = acquirePageScrollLock(document);
        expect(document.body.style.paddingInlineEnd).toBe(""); release();
    });
    it("disables vendor scroll management only for explicitly locked dialogs", () => {
        const root = document.createElement("div"); document.body.append(root);
        const unlocked = prepareDialogOptions({}); unlocked.success(root, 1);
        expect(document.body.style.overflow).toBe(""); unlocked.end();
        const locked = prepareDialogOptions({ scrollbar: false });
        expect(locked.scrollbar).toBe(true); locked.success(root, 2);
        expect(document.body.style.overflow).toBe("hidden");
        locked.end(); expect(document.body.style.overflow).toBe("");
    });
    it("releases a dialog lock when its success callback fails", () => {
        const root = document.createElement("div"); document.body.append(root);
        const options = prepareDialogOptions({ scrollbar: false, success: () => { throw new Error("fixture"); } });
        expect(() => options.success(root, 3)).toThrow("fixture");
        expect(document.body.style.overflow).toBe(""); options.end();
    });
    it("enhances footer keyboard actions once and blocks disabled anchors", () => {
        const root = document.createElement("div"); root.innerHTML = '<div class="layui-layer-btn"><a>确定</a></div>';
        document.body.append(root);
        const cleanup = enhanceDialogButtons(root), second = enhanceDialogButtons(root), button = root.querySelector("a"), action = vi.fn();
        button.addEventListener("click", action);
        expect(cleanup).toBe(second);
        for (const key of ["Enter", " "]) button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        expect(action).toHaveBeenCalledTimes(2);
        button.setAttribute("aria-disabled", "true"); button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(action).toHaveBeenCalledTimes(2); cleanup(); cleanup();
        const latest = enhanceDialogButtons(root); cleanup();
        button.removeAttribute("aria-disabled"); button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(action).toHaveBeenCalledTimes(3); latest();
    });
});
