// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDmmPreview } from "../src/services/preview-service.js";
import jqueryFactory from "jquery";

afterEach(() => vi.unstubAllGlobals());

describe("DMM preview persistence boundary", () => {
    it("reads the legacy cache key through the declared StorageService", async () => {
        const sources = { mhb_w: "https://example.test/preview.mp4" }, storage = {
            getLocal: vi.fn((key) => key === "jhs_dmm_video" ? JSON.stringify({ "ABC-123": sources }) : null),
            setLocal: vi.fn(),
        };
        vi.stubGlobal("clog", { debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
        await expect(fetchDmmPreview("ABC-123", storage)).resolves.toEqual({ sources, error: null });
        expect(storage.getLocal).toHaveBeenCalledWith("jhs_dmm_video");
        expect(storage.setLocal).not.toHaveBeenCalled();
    });

    it.each([true, false])("stores DMM result links without changing another view (found=%s)", async found => {
        document.body.innerHTML = `<a id="fanzaBtn" class="site-btn ${found ? "is-unavailable" : "is-available"}">DMM</a>`;
        const jquery = jqueryFactory.fn ? jqueryFactory : jqueryFactory(window);
        vi.stubGlobal("$", jquery);
        vi.stubGlobal("clog", { debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
        const sources = found ? { mhb_w: "https://example.test/preview.mp4" } : null;
        const movie = { preview: vi.fn(async () => ({ sources, matchType: "single", pageUrl: "https://example.test/detail", searchUrl: "https://example.test/search" })) };
        const storage = { getLocal: vi.fn(() => null), setLocal: vi.fn() };
        const result = await fetchDmmPreview("ABC-123", storage, movie);
        const button = document.querySelector("#fanzaBtn");
        expect(result.sources).toEqual(sources);
        expect(result.error).toBeNull();
        expect(button.getAttribute("href")).toBeNull();
        expect(button.classList.contains(found ? "is-unavailable" : "is-available")).toBe(true);
        if (found) expect(storage.setLocal).toHaveBeenCalledWith("jhs_other_site_dmm", expect.stringContaining('"url":"https://example.test/detail"'));
        expect(button.style.backgroundColor).toBe("");
    });
});
