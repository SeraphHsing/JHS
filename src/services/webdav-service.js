// @ts-check

import { JhsError } from "../core/jhs-error.js";

const DOWNLOAD_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
        await runStage("上传", () => this.request("PUT", `${folder}/${name}`, { "Content-Type": "text/plain" }, content), content.length);
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
    async deleteFile(name) { await this.request("DELETE", `${this.folderName}/${encodeURI(name)}`, { "Cache-Control": "no-cache" }); }
    /** @param {string} folder */
    async getBackupList(folder) { this.folderName = folder; await this.ensureFolder(folder); return this.getFileList(folder); }
    /** @param {string} name */
    async getFileContent(name) {
        let url = new URL(`${this.folderName}/${name}`.replace(/^\/+/, ""), this.baseUrl), anonymous = false;
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
    /** @param {import("./http-service.js").HttpService} http @param {import("./credential-service.js").CredentialService} [credential] @param {import("./settings-service.js").SettingsService} [settings] */
    constructor(http, credential = undefined, settings = undefined) { this.http = http; this.credential = credential; this.settings = settings; }
    /** @param {{url: string, username: string, password: string}} config */
    createClient(config) { return new WebDavClient(this.http, config.url, config.username, config.password); }
    /** Return the installation-local profile without exposing the encrypted password. */
    async getProfile() {
        const settings = this.settings?.snapshot?.() || {};
        const password = this.credential ? await this.credential.get("jhs_webdav_password") : "";
        return { url: String(settings.webDavUrl || ""), username: String(settings.webDavUsername || ""), password };
    }
    /** Atomically coordinate the GM credential write with the settings update. @param {Record<string, any>} [patch] @param {(draft: Record<string, unknown>) => unknown} [updateSettings] */
    async saveProfile(patch = {}, updateSettings) {
        if (!this.settings || !this.credential) throw new Error("WebDAV 配置服务未初始化");
        if (updateSettings != null && typeof updateSettings !== "function") throw new TypeError("WebDAV settings updater must be a function");
        const previous = /** @type {{password: string}} */ (await this.getProfile());
        const passwordChanged = Object.prototype.hasOwnProperty.call(patch, "password");
        if (passwordChanged) await /** @type {any} */ (this.credential).set("jhs_webdav_password", String(patch.password || ""));
        try {
            await this.settings.update((draft) => {
                for (const key of ["url", "username"]) if (Object.prototype.hasOwnProperty.call(patch, key)) draft[key === "url" ? "webDavUrl" : "webDavUsername"] = String(patch[key] || "");
                return updateSettings?.(draft);
            });
        } catch (error) {
            if (passwordChanged) await /** @type {any} */ (this.credential).set("jhs_webdav_password", previous.password);
            throw error;
        }
        return this.getProfile();
    }
}
