import { describe, expect, it, vi } from "vitest";
import { injectCoreCss } from "../src/core/css-injection.js";

describe("core CSS registration", () => {
    it("unwraps attributed style elements without discarding the first typography rule", () => {
        const register = vi.fn();
        injectCoreCss({ register });
        const css = register.mock.calls.find(([id]) => id === "jhs-ui-primitives")[1];
        expect(css.trimStart()).toMatch(/^:where\(/);
        expect(css).not.toMatch(/<\/?style\b/i);
        expect(css).toContain("font-family: var(--jhs-font)");
    });
});
