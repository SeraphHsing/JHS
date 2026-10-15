import { describe, expect, it } from "vitest";
import { FEATURE_ICONS } from "../src/core/feature-icons.js";
import { getIcon } from "../src/core/icons.js";
import { ICON_LICENSE } from "../src/core/icon-license.js";

describe("local semantic icon family", () => {
    it("preserves compatibility keys and the meaning of feature actions", () => {
        expect(Object.keys(FEATURE_ICONS)).toHaveLength(17);
        expect(FEATURE_ICONS.deleteSvg).toContain('data-jhs-icon="heart-off"');
        expect(FEATURE_ICONS.carNumSvg).toContain('data-jhs-icon="hash"');
        expect(FEATURE_ICONS.recoveryVideoSvg).toContain('data-jhs-icon="image"');
    });
    it("keeps every icon a themeable outline with no fixed colors", () => {
        for (const svg of Object.values(FEATURE_ICONS)) {
            expect(svg).toContain('viewBox="0 0 24 24"');
            expect(svg).toContain('stroke="currentColor"');
            expect(svg).toContain('fill="none"');
            expect(svg).toContain('aria-hidden="true"');
            expect(svg).not.toMatch(/#[\da-f]{3,8}|<script|on\w+=/i);
        }
        expect(() => getIcon('<script>')).toThrow(TypeError);
    });
    it("carries upstream source attribution and both applicable licenses", () => {
        expect(ICON_LICENSE).toContain("500620a2e8123f8d1db191538886dc0c223f69a9");
        expect(ICON_LICENSE).toContain("ISC");
        expect(ICON_LICENSE).toContain("MIT");
    });
});
