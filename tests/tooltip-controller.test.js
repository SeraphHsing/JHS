// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTooltips, dismissActiveTooltip } from "../src/core/tooltip-controller.js";
import { LifecycleScope } from "../src/core/lifecycle-scope.js";
import { OwnedPopover } from "../src/core/owned-popover.js";
let scope;
beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="host" title="宿主提示">宿主</button><div class="jhs-ui"><button id="owned" title="详细说明" aria-describedby="help">操作</button><span id="help">原说明</span><div id="menu"><button>菜单项</button></div></div>';
    scope = new LifecycleScope("tooltip-test"); initializeTooltips(scope, document);
});
afterEach(() => { scope.dispose(); vi.useRealTimers(); document.body.replaceChildren(); });
describe("owned tooltips", () => {
    it("supports focus, stable ids and additive descriptions without migrating host titles", () => {
        document.querySelector("#host").focus();
        expect(document.querySelector("[role=tooltip]")).toBeNull();
        expect(document.querySelector("#host").title).toBe("宿主提示");
        const owned = document.querySelector("#owned"); owned.focus();
        const tooltip = document.querySelector("[role=tooltip]"), id = tooltip.id;
        expect(tooltip.textContent).toBe("详细说明"); expect(owned.hasAttribute("title")).toBe(false);
        expect(owned.getAttribute("aria-describedby")).toBe(`help ${id}`);
        expect(dismissActiveTooltip(document)).toBe(true);
        expect(owned.getAttribute("aria-describedby")).toBe("help");
        owned.blur(); owned.focus(); expect(document.querySelector("[role=tooltip]").id).toBe(id);
    });
    it("keeps the tooltip open when the pointer moves into its content", () => {
        const owned = document.querySelector("#owned");
        owned.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); vi.advanceTimersByTime(50);
        const tooltip = document.querySelector("[role=tooltip]");
        owned.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: tooltip }));
        tooltip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: owned }));
        vi.advanceTimersByTime(200); expect(tooltip.isConnected).toBe(true);
        tooltip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
        vi.advanceTimersByTime(120); expect(tooltip.isConnected).toBe(false);
    });
    it("does not open or retain an ancestor card tooltip when its checkbox receives focus", () => {
        const card = document.createElement("div");
        card.className = "jhs-ui"; card.title = "影片卡片的长说明";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox";
        card.append(checkbox); document.body.append(card);
        checkbox.focus();
        expect(document.querySelector("[role=tooltip]")).toBeNull();
        card.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); vi.advanceTimersByTime(50);
        expect(document.querySelector("[role=tooltip]").textContent).toBe("影片卡片的长说明");
        card.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
        vi.advanceTimersByTime(120);
        expect(document.querySelector("[role=tooltip]")).toBeNull();
    });
    it("retains keyboard help on a label's associated control", () => {
        const label = document.createElement("label"); label.className = "jhs-ui"; label.title = "选项说明";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox";
        label.append(checkbox); document.body.append(label); checkbox.focus();
        expect(document.querySelector("[role=tooltip]").textContent).toBe("选项说明");
    });
    it("dismisses the tooltip before the containing menu on successive Escape presses", () => {
        const owned = document.querySelector("#owned"), menu = document.querySelector("#menu"), popover = new OwnedPopover(owned, menu);
        popover.open(owned); expect(document.querySelector("[role=tooltip]")).not.toBeNull();
        owned.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        expect(document.querySelector("[role=tooltip]")).toBeNull(); expect(popover.opened).toBe(true);
        owned.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        expect(popover.opened).toBe(false);
    });
    it("clears visible content, descriptions and pending timers on disposal", () => {
        const owned = document.querySelector("#owned"); owned.focus(); scope.dispose();
        expect(owned.getAttribute("aria-describedby")).toBe("help");
        owned.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); vi.advanceTimersByTime(100);
        expect(document.querySelector("[role=tooltip]")).toBeNull();
        expect(dismissActiveTooltip(document)).toBe(false);
    });
    it("releases the menu trigger tooltip when a menu command closes its owner", () => {
        const owned = document.querySelector("#owned"), menu = document.querySelector("#menu"), popover = new OwnedPopover(owned, menu);
        popover.open(owned); expect(document.querySelector("[role=tooltip]")).not.toBeNull();
        popover.close(); expect(document.querySelector("[role=tooltip]")).toBeNull();
        expect(owned.getAttribute("aria-describedby")).toBe("help");
    });
    it("cancels a pending hover tooltip before it can appear after Escape", () => {
        const owned = document.querySelector("#owned");
        owned.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
        owned.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        vi.advanceTimersByTime(100);
        expect(document.querySelector("[role=tooltip]")).toBeNull();
        expect(dismissActiveTooltip(document)).toBe(false);
    });
});
