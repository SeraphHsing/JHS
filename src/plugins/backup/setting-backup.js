// @ts-check

import { PRODUCT_NAMES } from "../../core/product-names.js";
import { escapeHtml } from "../../core/constants.js";
import { decryptCredential, decryptPortableBackup, encryptPortableBackup } from "../../core/credential-crypto.js";
import { createJhsTable } from "../../ui/table/create-jhs-table.js";
import { LifecycleScope } from "../../core/lifecycle-scope.js";

/** @typedef {{ name: string, size: number, createTime: string | number, fileId: string }} BackupFile */
/** @typedef {(diff: any, current: any, imported: any) => void} ShowDiffPreview */
/** @typedef {any} WebDavHandle */
/** @typedef {any} DialogHandle */
/** @typedef {{jquery: (value: any) => any, document: Document, legacyStorage: any, utilities: any, notifications: any, logger: any, domUi: any, window: Window & typeof globalThis, getScope?: () => Promise<LifecycleScope>}} BackupUiDependencies */
/** @param {unknown} error */
function backupErrorDetails(error) {
    const candidate = /** @type {any} */ (error);
    const code = typeof candidate?.code === "string" && /^[A-Z_]{2,32}$/.test(candidate.code) ? candidate.code : "UNKNOWN";
    const status = Number(candidate?.details?.status);
    return { code, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) };
}
/** @param {{stage: string, result: string, durationMs: number, bytes?: number, code?: string, status?: number, timeoutMs?: number}} event @param {any} logger */
function logBackupStage(event, logger) {
    const code = typeof event.code === "string" && /^[A-Z_]{2,32}$/.test(event.code) ? event.code : undefined;
    const record = {
        stage: event.stage, result: event.result, durationMs: Math.max(0, Math.round(event.durationMs)),
        ...(event.bytes == null ? {} : { bytes: event.bytes }),
        ...(event.timeoutMs == null ? {} : { timeoutMs: event.timeoutMs }),
        ...(code ? { code } : {}),
        ...(event.status == null ? {} : { status: event.status }),
    };
    try {
        if (event.result === "error") logger.warn?.("[WebDAV备份]", record);
        else logger.log?.("[WebDAV备份]", record);
    }
    catch { /* Logging must not change the backup result. */ }
}
/** @template T @param {string} stage @param {() => Promise<T>} action @param {BackupUiDependencies} dependencies */
async function measureBackupStage(stage, action, dependencies) {
    const { logger, window } = dependencies;
    const startedAt = window.performance.now();
    try {
        const result = await action();
        logBackupStage({ stage, result: "success", durationMs: window.performance.now() - startedAt }, logger);
        return result;
    } catch (error) {
        logBackupStage({ stage, result: "error", durationMs: window.performance.now() - startedAt, ...backupErrorDetails(error) }, logger);
        throw error;
    }
}
/** @param {any} webdavService @param {BackupUiDependencies} dependencies */
async function resolveWebDavProfile(webdavService, dependencies) {
    if (typeof webdavService?.getProfile === "function") return webdavService.getProfile();
    const { legacyStorage: storageManager } = dependencies;
    const settings = await storageManager.getSetting();
    return { url: settings.webDavUrl, username: settings.webDavUsername, password: await decryptCredential(settings.webDavPassword || "") };
}

/** Handle JSON file import via file input, run diff analysis, show preview. */
/** @param {ShowDiffPreview} showDiffPreviewFn @param {BackupUiDependencies} dependencies */
export async function importSettingData(showDiffPreviewFn, dependencies) {
    const { document, legacyStorage: storageManager, notifications: show, logger: clog, domUi, window } = dependencies;
    const loading = () => domUi.loading();
    const pickerScope = new LifecycleScope("backup-file-picker");
    try {
        const parentScope = await dependencies.getScope?.();
        if (parentScope?.disposed) return void pickerScope.dispose();
        const releaseParent = parentScope?.addCleanup(() => pickerScope.dispose());
        pickerScope.addCleanup(() => releaseParent?.());
        const input = document.createElement("input");
        input.type = "file", input.accept = ".json", input.hidden = true;
        let timer = 0;
        const cleanup = () => pickerScope.dispose();
        let inputRemoved = false;
        const removeInput = () => { if (!inputRemoved) { inputRemoved = true; input.remove(); } };
        pickerScope.addCleanup(() => { window.clearTimeout(timer); removeInput(); });
        pickerScope.listen(input, "cancel", cleanup, { once: true });
        pickerScope.listen(window, "pagehide", cleanup, { once: true });
        timer = window.setTimeout(cleanup, 3e5);
        input.onchange = async (/** @type {Event} */ e) => {
            const t = /** @type {HTMLInputElement} */ (e.currentTarget).files?.[0];
            if (!t) return void cleanup();
            window.clearTimeout(timer); removeInput();
            const n = new window.FileReader;
            pickerScope.addCleanup(() => { n.onload = null; n.onerror = null; if (n.readyState === 1) n.abort(); });
            n.onload = async (/** @type {ProgressEvent<FileReader>} */ e) => {
                if (pickerScope.disposed) return;
                try {
                    const t = String((/** @type {FileReader} */ (e.currentTarget)).result || ""), n = JSON.parse(t);
                    if (!n || "object" != typeof n || Array.isArray(n)) throw new Error("文件内容不是有效的数据对象");
                    const a = loading();
                    const releaseLoading = pickerScope.addCleanup(() => a.close());
                    try {
                        const e = await storageManager.exportData();
                        if (pickerScope.disposed) return;
                        const t = await storageManager.diffData(e, n);
                        if (pickerScope.disposed) return;
                        releaseLoading(), showDiffPreviewFn(t, n, null);
                    } catch (i) {
                        if (!pickerScope.disposed) { clog.error(i); show.error("导入预览失败，请重试"); }
                    }
                } catch (t) {
                    if (!pickerScope.disposed) { clog.error(t); show.error("导入失败，请检查文件格式"); }
                } finally { cleanup(); }
            }, n.onerror = () => {
                if (!pickerScope.disposed) show.error("文件读取失败，请重试");
                cleanup();
            }, n.readAsText(t);
        }, document.body.appendChild(input), input.click();
    } catch (e) {
        pickerScope.dispose();
        clog.error(e), show.error("导入失败，请重新选择文件");
    }
}

/** Create encrypted backup and upload via WebDAV. */
/** @param {string} folderName @param {WebDavHandle} webdavService @param {BackupUiDependencies} dependencies */
export async function backupDataByWebDav(folderName, webdavService, dependencies) {
    const { legacyStorage: storageManager, utilities: utils, notifications: show, logger: clog, domUi, window } = dependencies;
    const loading = () => domUi.loading();
    const logStage = (/** @type {{stage: string, result: string, durationMs: number, bytes?: number, code?: string, status?: number, timeoutMs?: number}} */ event) => logBackupStage(event, clog);
    const r = loading();
    const startedAt = window.performance.now();
    let result = "error", bytes;
    try {
        const t = await measureBackupStage("读取凭据", () => resolveWebDavProfile(webdavService, dependencies), dependencies), n = t.url;
        if (!n) return void show.error("请填写并保存服务地址");
        const a = t.username;
        if (!a) return void show.error("请填写并保存用户名");
        if (!t.password) return void show.error("请填写并保存密码");
        const s = utils.getNowStr("_", "_") + ".json";
        const plain = await measureBackupStage("导出数据", async () => JSON.stringify(await storageManager.exportData()), dependencies);
        const encrypted = await measureBackupStage("加密", () => encryptPortableBackup(plain), dependencies);
        bytes = encrypted.length;
        const client = webdavService.createClient({ url: n, username: a, password: t.password });
        await client.backup(folderName, s, encrypted, logStage);
        result = "success";
    } catch (l) {
        clog.error("[WebDAV备份失败]", backupErrorDetails(l)), show.error("备份失败，请检查连接与授权");
    } finally {
        logStage({ stage: "合计", result, durationMs: window.performance.now() - startedAt, ...(bytes == null ? {} : { bytes }) });
        try { r.close(); }
        catch (error) {
            try { clog.warn("[WebDAV备份] 关闭加载提示失败", backupErrorDetails(error)); }
            catch { /* A completed upload must remain successful if diagnostics fail. */ }
        }
    }
    if (result === "success") {
        try { show.ok("已备份数据"); }
        catch (error) { clog.warn("[WebDAV备份] 上传成功，但完成提示失败", backupErrorDetails(error)); }
    }
}

/** List WebDAV backups and open the file list dialog. */
/** @param {string} folderName @param {Function} openFileListDialogFn @param {WebDavHandle} webdavService @param {BackupUiDependencies} dependencies */
export async function backupListBtnByWebDav(folderName, openFileListDialogFn, webdavService, dependencies) {
    const { notifications: show, logger: clog, domUi } = dependencies;
    const loading = () => domUi.loading();
    const t = await resolveWebDavProfile(webdavService, dependencies), n = t.url;
    if (!n) return void show.error("请填写并保存服务地址");
    const a = t.username;
    if (!a) return void show.error("请填写并保存用户名");
    if (!t.password) return void show.error("请填写并保存密码");
    const s = loading();
    try {
        const i = t.password;
        const e = webdavService.createClient({ url: n, username: a, password: i }), files = await e.getBackupList(folderName);
        openFileListDialogFn(files, e, PRODUCT_NAMES.webdav);
    } catch (o) {
        clog.error(o), show.error("备份列表加载失败，请重试");
    } finally {
        s.close();
    }
}

/** Mobile-specific backup file list dialog using card-based UI. */
/** @param {BackupFile[]} e @param {WebDavHandle} t @param {string} n @param {string} folderName @param {ShowDiffPreview} showDiffPreviewFn @param {DialogHandle} dialog @param {BackupUiDependencies} dependencies */
function openFileListDialogMobile(e, t, n, folderName, showDiffPreviewFn, dialog, dependencies) {
    const { jquery: $, legacyStorage: storageManager, utilities: utils, notifications: show, logger: clog, domUi } = dependencies;
    const loading = () => domUi.loading();
    const formatSize = (/** @type {number} */ size) => {
        const units = ["B", "KB", "MB", "GB", "TB", "PB"];
        let i = 0, s = size;
        for (; s >= 1024 && i < units.length - 1;) s /= 1024, i++;
        return `${s % 1 == 0 ? s.toFixed(0) : s.toFixed(2)} ${units[i]}`;
    };
    const renderCards = (/** @type {BackupFile[]} */ files) => {
        if (!files || files.length === 0) {
            return '<div class="jhs-backup-empty">暂无备份</div>';
        }
        return files.map((file, /** @type {number} */ idx) => `
                <div class="jhs-backup-card" data-idx="${idx}">
                    <div class="jhs-backup-card-name">${escapeHtml(file.name)}</div>
                    <div class="jhs-backup-card-meta">${formatSize(file.size)} · ${utils.getNowStr("-", ":", file.createTime)}</div>
                    <div class="jhs-backup-card-actions">
                        <button class="jhs-btn jhs-backup-btn jhs-backup-btn-danger" data-action="delete" data-idx="${idx}">删除</button>
                        <button class="jhs-btn jhs-backup-btn jhs-backup-btn-primary" data-action="download" data-idx="${idx}">下载</button>
                        <button class="jhs-btn jhs-backup-btn jhs-backup-btn-success" data-action="import" data-idx="${idx}">导入</button>
                    </div>
                </div>
            `).join("");
    };
    const containerId = "jhs-backup-card-list";
    dialog.open({
        type: 1,
        title: n + "备份文件",
        content: `<div id="${containerId}" class="jhs-backup-cards">${renderCards(e)}</div>`,
        area: utils.getResponsiveArea(["800px", "70%"]),
        anim: -1,
        success: (/** @type {HTMLElement} */ layerEl) => {
            const container = $(layerEl).find(`#${containerId}`);
            container.on("click", ".jhs-backup-btn", async (/** @type {MouseEvent} */ ev) => {
                const btn = $(ev.currentTarget);
                const action = btn.data("action");
                const idx = btn.data("idx");
                const file = e[idx];
                if (!file) return;
                if (action === "delete") {
                    dialog.confirm(`删除备份“${escapeHtml(file.name)}”？此操作无法撤销`, {
                        icon: 3, title: "提示", confirmText: "删除", cancelText: "取消"
                    }, async (/** @type {number} */ confirmIdx) => {
                        dialog.close(confirmIdx);
                        let load = loading();
                        try {
                            await t.deleteFile(file.fileId);
                            e = await t.getBackupList(folderName);
                            container.html(renderCards(e));
                            show.ok("已删除备份");
                        } catch (err) {
                            clog.error(err), show.error("备份删除失败，请重试");
                        } finally { load.close(); }
                    });
                } else if (action === "download") {
                    let load = loading();
                    try {
                        const data = await decryptPortableBackup(await t.getFileContent(file.fileId));
                        utils.download(data, file.name);
                    } catch (err) {
                        clog.error(err), show.error("备份下载失败，请重试");
                    } finally { load.close(); }
                } else if (action === "import") {
                    let load = loading();
                    try {
                        let data = await t.getFileContent(file.fileId);
                        data = await decryptPortableBackup(data);
                        const parsed = JSON.parse(data);
                        const currentData = await storageManager.exportData();
                        const diff = await storageManager.diffData(currentData, parsed);
                        load.close();
                        showDiffPreviewFn(diff, null, parsed);
                    } catch (err) {
                        load.close(), clog.error(err), show.error("备份预览失败，请检查文件");
                    }
                }
            });
        }
    });
}

/** Desktop backup file list dialog using Tabulator table. */
/** @param {BackupFile[]} e @param {WebDavHandle} t @param {string} n @param {string} folderName @param {ShowDiffPreview} showDiffPreviewFn @param {DialogHandle} dialog @param {BackupUiDependencies} dependencies */
export function openFileListDialog(e, t, n, folderName, showDiffPreviewFn, dialog, dependencies) {
    const { jquery: $, legacyStorage: storageManager, utilities: utils, notifications: show, logger: clog, domUi } = dependencies;
    const loading = () => domUi.loading();
    if (utils.isMobileMode()) {
        openFileListDialogMobile(e, t, n, folderName, showDiffPreviewFn, dialog, dependencies);
        return;
    }
    dialog.open({
        type: 1,
        title: n + "备份文件",
        content: '\n                <div class="jhs-table-dialog"> \n                    <div id="table-container" class="jhs-table-dialog__content"></div>\n                </div>\n            ',
        area: utils.getResponsiveArea([ "800px", "70%" ]),
        anim: -1,
        success: (/** @type {HTMLElement} */ a) => {
            const tableRoot = $(a).find(".jhs-table-dialog__content").get(0) || $(a).find("#table-container").get(0);
            const i = createJhsTable(domUi.tableConstructor, tableRoot, {
                pagination: !1,
                layout: "fitColumns",
                placeholder: "暂无备份",
                virtualDom: !0,
                data: e,
                responsiveLayout: "collapse",
                responsiveLayoutCollapse: !0,
                columnDefaults: {
                    headerHozAlign: "center",
                    hozAlign: "center"
                },
                columns: [ {
                    title: "文件名",
                    field: "name",
                    width: 200,
                    headerSort: !1,
                    responsive: 0
                }, {
                    title: "文件大小",
                    field: "size",
                    responsive: 1,
                    headerSort: !1,
                    formatter: (/** @type {any} */ e, /** @type {any} */ t, /** @type {any} */ n) => {
                        const a = [ "B", "KB", "MB", "GB", "TB", "PB" ];
                        let i = 0, s = e.getData().size;
                        for (;s >= 1024 && i < a.length - 1; ) s /= 1024, i++;
                        return `${s % 1 == 0 ? s.toFixed(0) : s.toFixed(2)} ${a[i]}`;
                    }
                }, {
                    title: "备份日期",
                    field: "createTime",
                    responsive: 2,
                    headerSort: !1,
                    formatter: (/** @type {any} */ e, /** @type {any} */ t, /** @type {any} */ n) => {
                        const a = e.getData();
                        return `${utils.getNowStr("-", ":", a.createTime)}`;
                    }
                }, {
                    title: "操作",
                    minWidth: 250,
                    responsive: 0,
                    headerSort: !1,
                    formatter: (/** @type {any} */ e, /** @type {any} */ a, /** @type {(callback: () => void) => void} */ s) => {
                        const o = e.getData();
                        return s((() => {
                            const a = e.getElement().querySelector(".backup-delete"), s = e.getElement().querySelector(".backup-download"), r = e.getElement().querySelector(".backup-import");
                            a && a.addEventListener("click", ((/** @type {MouseEvent} */ e) => {
                                dialog.confirm(`删除备份“${escapeHtml(o.name)}”？此操作无法撤销`, {
                                    icon: 3,
                                    title: "提示",
                                    confirmText: "删除", cancelText: "取消"
                                }, (async (/** @type {number} */ e) => {
                                    dialog.close(e);
                                    let a = loading();
                                    try {
                                        await t.deleteFile(o.fileId);
                                        let e = await t.getBackupList(folderName);
                                        i.replaceData(e), show.ok("已删除备份");
                                    } catch (s) {
                                        clog.error(s), show.error("备份删除失败，请重试");
                                    } finally {
                                        a.close();
                                    }
                                }));
                            })), s && s.addEventListener("click", (async (/** @type {MouseEvent} */ e) => {
                                let a = loading();
                                try {
                                    const e = await decryptPortableBackup(await t.getFileContent(o.fileId));
                                        utils.download(e, o.name);
                                } catch (i) {
                                    clog.error(i), show.error("备份下载失败，请重试");
                                } finally {
                                    a.close();
                                }
                            })), r && r.addEventListener("click", (async (/** @type {MouseEvent} */ e) => {
                                let a = loading();
                                try {
                                    let e = await t.getFileContent(o.fileId);
                                    e = await decryptPortableBackup(e);
                                    const n = JSON.parse(e), i = await storageManager.exportData(), s = await storageManager.diffData(i, n);
                                    a.close(), showDiffPreviewFn(s, null, n);
                                } catch (i) {
                                    a.close(), clog.error(i), show.error("备份预览失败，请检查文件");
                                }
                            }));
                        })), '\n                                    <button type="button" class="jhs-btn jhs-btn--danger backup-delete">删除</button>\n                                    <button type="button" class="jhs-btn jhs-btn--secondary backup-download">下载</button>\n                                    <button type="button" class="jhs-btn jhs-btn--secondary backup-import">导入</button>\n                                ';
                    }
                } ]
            });
        }
    });
}

/** Export all data as a downloadable JSON file. */
/** @param {BackupUiDependencies} dependencies */
export async function exportSettingData(dependencies) {
    const { legacyStorage: storageManager, utilities: utils, notifications: show, logger: clog } = dependencies;
    try {
        const e = JSON.stringify(await storageManager.exportData()), t = `${utils.getNowStr("_", "_")}.json`;
        utils.download(e, t), show.ok("已导出数据");
    } catch (t) {
        clog.error(t), show.error("数据导出失败，请重试");
    }
}
