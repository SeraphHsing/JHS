// @ts-check
import { LifecycleScope } from "../../core/lifecycle-scope.js";
import { closeOwnedPopover, ownedPopoverRoots } from "../../core/owned-popover.js";

/** Keep a hover form and its portalled controls inside one logical interaction region. */
export class DesktopQuickSettings {
    /** @param {{box:HTMLElement,host:HTMLElement,jquery:any,scope:LifecycleScope,initialize:()=>Promise<void>,onError:(error:unknown)=>void,onOpen:()=>void}} options */
    constructor(options) {
        this.options = options;
        this.box = options.box;
        this.host = options.host;
        this.scope = new LifecycleScope("desktop-quick-settings");
        this.releaseOwner = options.scope.addCleanup(() => this.scope.dispose());
        this.opened = false;
        this.pointerInside = false;
        /** @type {ReturnType<typeof setTimeout> | null} */ this.timer = null;
        /** @type {Promise<void> | null} */ this.loading = null;
        this.ready = false;
        this.generation = 0;
        const doc = this.box.ownerDocument;
        options.jquery(this.box).on("mouseenter.jhsQuickHover", () => { this.pointerInside = true; void this.open(); })
            .on("mouseleave.jhsQuickHover", () => { this.pointerInside = false; this.scheduleClose(); });
        this.scope.listen(doc, "pointermove", event => {
            this.pointerInside = this.contains(/** @type {Node} */ (event.target));
            if (this.pointerInside) this.cancelClose(); else if (this.opened) this.scheduleClose();
        }, true);
        this.scope.listen(doc, "focusin", event => {
            if (this.contains(/** @type {Node} */ (event.target))) this.cancelClose(); else this.scheduleClose();
        }, true);
        this.scope.listen(doc, "focusout", () => this.scheduleClose(), true);
        this.scope.listen(doc, "pointerdown", event => {
            if (this.opened && !this.contains(/** @type {Node} */ (event.target))) this.close();
        }, true);
        this.scope.listen(doc, "keydown", event => {
            const key = /** @type {KeyboardEvent} */ (event);
            if (!this.opened || key.key !== "Escape" || ownedPopoverRoots(this.host).length) return;
            key.preventDefault(); this.close(); this.box.querySelector("button")?.focus();
        });
        this.scope.addCleanup(() => {
            this.releaseOwner?.(); this.close(); options.jquery(this.box).off(".jhsQuickHover");
            options.jquery(this.host).data("jhsQuickSettingBinding")?.dispose?.();
            options.jquery(this.host).removeData("jhsQuickSettingBinding").empty();
        });
    }
    /** @param {Node | null} target */
    contains(target) {
        return !!target && (this.box.contains(target) || ownedPopoverRoots(this.host).some(root => root.contains(target)));
    }
    cancelClose() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
    scheduleClose() {
        if (!this.opened || this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.pointerInside && !this.contains(this.box.ownerDocument.activeElement)) this.close();
        }, 200);
    }
    async open() {
        if (this.scope.disposed || !this.box.isConnected) return;
        this.cancelClose();
        if (!this.opened) { this.options.onOpen(); closeOwnedPopover(this.box.ownerDocument); }
        this.opened = true;
        const generation = ++this.generation;
        if (!this.ready) {
            this.loading ??= this.options.initialize().then(() => { this.ready = true; }).catch(error => {
                this.options.onError(error); this.loading = null; this.close();
            });
            await this.loading;
        }
        if (this.ready && this.opened && generation === this.generation && !this.scope.disposed && this.box.isConnected) this.options.jquery(this.host).show();
        else if (!this.opened || this.scope.disposed) this.options.jquery(this.host).hide();
    }
    close() {
        this.cancelClose(); this.opened = false; this.generation++;
        if (ownedPopoverRoots(this.host).length) closeOwnedPopover(this.box.ownerDocument);
        this.options.jquery(this.host).hide();
    }
    dispose() { this.scope.dispose(); }
}
