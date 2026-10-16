// @ts-check

/** Format UI timestamps in the viewer's local time without changing stored values. @param {unknown} value */
export function formatUiDateTime(value) {
    if (value == null || value === "" || value === 0) return "无";
    if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return "无";
    const input = typeof value === "string" ? value.trim() : value;
    if (input === "") return "无";
    const date = new Date(typeof input === "string" && /^\d+$/.test(input) ? Number(input) : /** @type {string | number} */ (input));
    if (!Number.isFinite(date.getTime()) || date.getTime() === 0) return "无";
    const pad = (/** @type {number} */ number) => String(number).padStart(2, "0");
    return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
