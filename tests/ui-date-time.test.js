import { describe, expect, it } from "vitest";
import { formatUiDateTime } from "../src/core/ui-date-time.js";

describe("local UI timestamps", () => {
    it("formats stored date strings, Date objects and numeric timestamps consistently", () => {
        const local = new Date(2026, 9, 15, 7, 8, 9), expected = "2026-10-15 07:08:09";
        for (const value of [local, local.getTime(), String(local.getTime()), "2026-10-15 07:08:09"]) expect(formatUiDateTime(value)).toBe(expected);
        expect(local.getTime()).toBe(new Date(2026, 9, 15, 7, 8, 9).getTime());
    });
    it("uses the viewer's local date components for zoned timestamps", () => {
        const value = "2026-10-14T23:08:09Z", date = new Date(value), pad = number => String(number).padStart(2, "0");
        expect(formatUiDateTime(value)).toBe(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
    });
    it.each([undefined, null, "", "  ", 0, "0", NaN, Infinity, false, {}, "invalid time", new Date(NaN)])("does not expose a missing or invalid date: %s", value => {
        expect(formatUiDateTime(value)).toBe("无");
    });
});
