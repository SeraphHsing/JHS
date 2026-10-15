import { describe, expect, it } from "vitest";
import { getImageView } from "../src/core/image-viewer.js";

describe("image camera defaults", () => {
    it("uses the declared source kind for the real sub-2 contact sheet and tall photographs", () => {
        expect(getImageView(906, 1784, 906, 540, "default", "contact-sheet")).toEqual({ratio:1,x:0,y:0});
        expect(getImageView(1000, 1999, 360, 540, "default", "contact-sheet")).toEqual({ratio:.36,x:0,y:0});
        expect(getImageView(1000, 2500, 1440, 800, "default", "photo")).toEqual({ratio:.32,x:560,y:0});
        expect(getImageView(906, 1784, 906, 540, "contain", "contact-sheet").ratio).toBe(540/1784);
    });
    it("contains landscape images in the canvas above the controls", () => {
        expect(getImageView(1280, 720, 360, 540)).toEqual({ratio: .28125, x: 0, y: 168.75});
    });
    it("fits long images to width and places their first row at the canvas top", () => {
        expect(getImageView(1280, 3600, 360, 540)).toEqual({ratio: .28125, x: 0, y: 0});
        expect(getImageView(1000, 2000, 1440, 800)).toEqual({ratio: 1.44, x: 0, y: 0});
        expect(getImageView(1000, 1999, 1440, 800).ratio).toBe(800 / 1999);
    });
    it("lets the user contain a whole sheet or inspect its natural pixels", () => {
        const whole = getImageView(1280, 3600, 360, 540, "contain");
        expect(whole.ratio).toBe(.15);
        expect(whole.y).toBe(0);
        expect(whole.x).toBe(84);
        expect(getImageView(1280, 3600, 360, 540, "natural")).toEqual({ratio: 1, x: -460, y: -1530});
    });
});
