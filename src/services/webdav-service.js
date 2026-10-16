// @ts-check

import { JhsError } from "../core/jhs-error.js";
import { CREDENTIAL_KEYS } from "./credential-service.js";

const DOWNLOAD_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** @param {string} name */
function encodeBackupFileName(name) {
    if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\\]/.test(name)) throw new JhsError("INVALID_URL", "备份文件名必须是单个有效文件名", { source: "WebDavClient" });
    return encodeURIComponent(name);
}

export class WebDavClient {
    /** @param {import("./http-service.js").HttpService} http @param {string} davUrl @param {string} username @param {string} password */
    constructor(http, davUrl, username, password) {
        this.http = http;
        this.baseUrl = new URL(davUrl.endsWith("/") ? davUrl : `${davUrl}/`);
        this.username = username;
        this.password = password;
        this.folderName = null;
    }
    authHeaders() {
        // TextEncoder 编码后再 btoa，兼容非 Latin1（中文）用户名/密码
        const bytes = new TextEncoder().encode(`${this.username}:${this.password}`);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { Authorization: `Basic ${btoa(binary)}`, Depth: "1" };
    }
    /** @param {string} method @param {string} path @param {Record<string, string>} [headers] @param {unknown} [body] @param {Record<string, unknown>} [requestOptions] */
    async request(method, path, headers = {}, body, requestOptions = {}) {
        const url = new URL(path.replace(/^\/+/, ""), this.baseUrl);
        const response = await this.#requestResponse(method, url, headers, body, requestOptions);
        return response.data ?? response.responseText ?? "";
    }
    /** Return response metadata while isolating anonymous download hops. @param {string} method @param {URL} url @param {Record<string, string>} headers @param {unknown} body @param {Record<string, unknown>} requestOptions @param {boolean} [anonymous] */
    async #requestResponse(method, url, headers, body, requestOptions, anonymous = false) {
        return this.http.request({
            providerId: "webdav", method, url: url.href, headers: anonymous ? headers : { ...this.authHeaders(), ...headers }, body,
            responseType: "text", cacheScope: "none", ...requestOptions, timeout: 10_000,
            urlPolicy: { trustClass: anonymous ? "custom-public" : "user-local", expectedOrigin: anonymous ? url.origin : this.baseUrl.origin },
        });
    }
    /** @param {string} folder */
    async ensureFolder(folder) {
        // Existing WebDAV collections report 405|409 and are valid outcomes.
        await this.request("MKCOL", folder, {}, undefined, { acceptableStatuses: [405, 409] });
    }
    /** @param {string} folder @param {string} name @param {string} content @param {(event: {stage: string, result: string, durationMs: number, bytes?: number, code?: string, status?: number, timeoutMs: number}) => void} [onStage] */
    async backup(folder, name, content, onStage) {
        const encodedName = encodeBackupFileName(name);
        /** @template T @param {string} stage @param {() => Promise<T>} action @param {number} [bytes] @returns {Promise<T>} */
        const runStage = async (stage, action, bytes) => {
            const startedAt = performance.now();
            let result = "success", code, status;
            try { return await action(); }
            catch (error) {
                result = "error";
                if (error && typeof error === "object") {
                    const failure = /** @type {any} */ (error);
                    code = typeof failure.code === "string" ? failure.code : undefined;
                    status = Number.isFinite(failure.details?.status) ? failure.details.status : undefined;
                }
                throw error;
            } finally {
                try { onStage?.({ stage, result, durationMs: Math.round(performance.now() - startedAt), ...(bytes == null ? {} : { bytes }), ...(code ? { code } : {}), ...(status == null ? {} : { status }), timeoutMs: 10_000 }); }
                catch { /* Diagnostics must not change the backup result. */ }
            }
        };
        await runStage("建目录", () => this.ensureFolder(folder));
        await runStage("上传", () => this.request("PUT", `${folder}/${encodedName}`, { "Content-Type": "text/plain" }, content), content.length);
    }
    /** @param {string} folder */
    async getFileList(folder) {
        const xml = String(await this.request("PROPFIND", folder, { "Content-Type": "application/xml" }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:creationdate/><d:getlastmodified/><d:iscollection/></d:prop></d:propfind>'));
        const responses = new DOMParser().parseFromString(xml, "text/xml").getElementsByTagNameNS("DAV:", "response"), files = [];
        for (let index = 1; index < responses.length; index++) {
            const item = responses[index], node = (/** @type {string} */ name) => item.getElementsByTagNameNS("DAV:", name)[0]?.textContent || "";
            const href = node("href"), name = node("displayname") || decodeURIComponent(href.replace(/\/$/, "").split("/").pop() || ""), size = node("getcontentlength");
            if (size !== "0") files.push({ fileId: name, name, size: Number(size), createTime: node("creationdate") || node("getlastmodified") });
        }
        return files.reverse();
    }
    /** @param {string} name */
    async deleteFile(name) { await this.request("DELETE", `${this.folderName}/${encodeBackupFileName(name)}`, { "Cache-Control": "no-cache" }); }
    /** @param {string} folder */
    async getBackupList(folder) { this.folderName = folder; await this.ensureFolder(folder); return this.getFileList(folder); }
    /** @param {string} name */
    async getFileContent(name) {
        let url = new URL(`${this.folderName}/${encodeBackupFileName(name)}`.replace(/^\/+/, ""), this.baseUrl), anonymous = false;
        const visited = new Set();
        for (let redirects = 0; ; redirects++) {
            url.hash = "";
            if (visited.has(url.href)) throw new JhsError("INVALID_URL", "WebDAV 下载跳转形成循环", { source: "WebDavClient" });
            visited.add(url.href);
            const response = await this.#requestResponse("GET", url, { Accept: "application/octet-stream" }, undefined, {
                requestOptions: { redirect: "manual", ...(anonymous ? { anonymous: true } : {}) },
            }, anonymous);
            const status = Number(response.status);
            if (status >= 200 && status < 300) return String(response.data ?? response.responseText ?? "");
            if (!DOWNLOAD_REDIRECT_STATUSES.has(status)) throw new JhsError("NETWORK_ERROR", "WebDAV 下载返回无效响应", { source: "WebDavClient", details: { status } });
            if (redirects >= 5) throw new JhsError("INVALID_URL", "WebDAV 下载跳转次数超过限制", { source: "WebDavClient" });
            const location = String(response.responseHeaders ?? "").match(/^location\s*:\s*(.+)$/im)?.[1]?.trim();
            if (!location) throw new JhsError("INVALID_URL", "WebDAV 下载跳转缺少可读取的 Location", { source: "WebDavClient" });
            try { url = new URL(location, url); }
            catch { throw new JhsError("INVALID_URL", "WebDAV 下载跳转地址无效", { source: "WebDavClient" }); }
            if (url.username || url.password) throw new JhsError("INVALID_URL", "WebDAV 下载跳转地址不能包含凭证", { source: "WebDavClient" });
            anonymous ||= url.origin !== this.baseUrl.origin;
        }
    }
}

export class WebDavService {
    /** @param {import("./http-service.js").HttpService} http @param {import("./credential-service.js").CredentialService} [credential] @param {import("./settings-service.js").SettingsService} [settings] @param {string} [pageOrigin] */
    constructor(http, credential = undefined, settings = undefined, pageOrigin = globalThis.location?.origin) {
        this.http = http; this.credential = credential; this.settings = settings;
        const origin = pageOrigin ? new URL(pageOrigin).origin : null;
        this.passwordKey = origin && origin !== "null" ? `${CREDENTIAL_KEYS.webDavPassword}:origin:${encodeURIComponent(origin)}` : null;
    }
    /** @param {{url: string, username: string, password: string}} config */
    createClient(config) { return new WebDavClient(this.http, config.url, config.username, config.password); }
    /** Read the site-local profile in the same queue as profile saves. */
    async getProfile() {
        return this.settings ? this.settings.runExclusive(() => this.readProfileWithoutLock()) : this.readProfileWithoutLock();
    }
    /** Caller holds the settings lock; never re-enter getProfile/update here. */
    async readProfileWithoutLock() {
        const settings = this.settings?.snapshot?.() || {};
        let password = "";
        if (this.credential) {
            if (!this.passwordKey) throw new Error("无法确定 WebDAV 所属站点，请重新打开设置");
            try {
                const entry = await this.credential.readEntry(this.passwordKey);
                password = entry.value;
                if (!entry.exists) {
                    const legacy = await this.credential.readEntry(CREDENTIAL_KEYS.webDavPassword);
                    if (legacy.exists) password = await this.credential.replaceWithRollback(this.passwordKey, legacy.value, async () => legacy.value);
                }
            } catch (cause) {
                throw Object.assign(new Error("此站点 WebDAV 密码无法读取，请重新输入密码并保存", { cause }), { code: "WEBDAV_CREDENTIAL_UNREADABLE" });
            }
        }
        return { url: String(settings.webDavUrl || ""), username: String(settings.webDavUsername || ""), password };
    }
    /** Serialize site-local credential/settings writes and rollback under their shared lock. @param {Record<string, any>} [patch] @param {(draft: Record<string, unknown>) => unknown} [updateSettings] */
    async saveProfile(patch = {}, updateSettings) {
        if (!this.settings || !this.credential) throw new Error("WebDAV 配置服务未初始化");
        if (updateSettings != null && typeof updateSettings !== "function") throw new TypeError("WebDAV settings updater must be a function");
        const settings = this.settings, credential = this.credential;
        return settings.runExclusive(async () => {
            const passwordChanged = Object.prototype.hasOwnProperty.call(patch, "password");
            const password = passwordChanged ? String(patch.password || "") : (await this.readProfileWithoutLock()).password;
            const persist = async () => {
                await settings.updateWithoutLock((draft) => {
                    for (const key of ["url", "username"]) if (Object.prototype.hasOwnProperty.call(patch, key)) draft[key === "url" ? "webDavUrl" : "webDavUsername"] = String(patch[key] || "");
                    return updateSettings?.(draft);
                });
                const saved = settings.snapshot();
                return { url: String(saved.webDavUrl || ""), username: String(saved.webDavUsername || ""), password };
            };
            if (passwordChanged) {
                if (!this.passwordKey) throw new Error("无法确定 WebDAV 所属站点，请重新打开设置");
                return credential.replaceWithRollback(this.passwordKey, password, persist);
            }
            return persist();
        });
    }
}
