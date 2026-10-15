import { fileURLToPath } from "node:url";

/** Load the real Layer fixture before the application captures its vendor port. */
export async function injectRealLayer(page) {
  await page.addStyleTag({ path: fileURLToPath(new URL("../fixtures/layer-runtime/layer.css", import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL("../fixtures/layer-runtime/layer-1.0.9.min.js", import.meta.url)) });
  await page.waitForFunction(() => window.layer?.v === "3.0.1" && typeof window.layer.config === "function" && typeof window.layer.confirm === "function");
}
