import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialService, CREDENTIAL_KEYS } from "../src/services/credential-service.js";
import { SettingsService } from "../src/services/settings-service.js";
import { WebDavService } from "../src/services/webdav-service.js";
import { StorageMutationCoordinator } from "../src/core/storage-mutation-coordinator.js";

const pageOrigin = "https://javdb.com";
const scopedKey = origin => `${CREDENTIAL_KEYS.webDavPassword}:origin:${encodeURIComponent(origin)}`;

function fixture({ origin = pageOrigin, gm = new Map(), coordinator = new StorageMutationCoordinator({ lockManager: null }), persisted = {} } = {}) {
    const values = { setting: { webDavUrl: "https://old.example/dav", webDavUsername: "old-user", ...persisted } };
    const storage = {
        get: vi.fn(async key => structuredClone(values[key])),
        set: vi.fn(async (key, value) => { values[key] = structuredClone(value); }),
    };
    const credentialStorage = {
        getValue: vi.fn((key, fallback) => gm.has(key) ? gm.get(key) : fallback),
        setValue: vi.fn((key, value) => { gm.set(key, value); }),
        removeValue: vi.fn(key => { gm.delete(key); }),
    };
    const credential = new CredentialService(credentialStorage, { getItem: () => null });
    const settings = new SettingsService(storage, { mutationCoordinator: coordinator });
    const webdav = new WebDavService({}, credential, settings, origin);
    return { values, storage, gm, credentialStorage, credential, settings, webdav, coordinator };
}

afterEach(() => vi.unstubAllGlobals());

describe("site-local WebDAV profile", () => {
    it("migrates a readable shared legacy credential once and preserves the legacy record", async () => {
        const test = fixture();
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "legacy-password");
        const legacy = structuredClone(test.gm.get(CREDENTIAL_KEYS.webDavPassword));
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "legacy-password", username: "old-user" });
        expect(test.gm.get(scopedKey(pageOrigin))).toMatchObject({ schema: 2, ciphertext: expect.any(String) });
        expect(test.gm.get(CREDENTIAL_KEYS.webDavPassword)).toEqual(legacy);
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "later-legacy-password");
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "legacy-password" });
    });

    it("does not create a credential when neither key exists", async () => {
        const test = fixture();
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "" });
        expect(test.credentialStorage.setValue).not.toHaveBeenCalled();
    });

    it("can later migrate a newly available legacy source but never resurrects an explicit clear", async () => {
        const test = fixture();
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "" });
        expect(test.gm.has(scopedKey(pageOrigin))).toBe(false);
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "later-legacy-password");
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "later-legacy-password" });
        await test.webdav.saveProfile({ password: "" });
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "newer-legacy-password");
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "" });
    });

    it("keeps credentials isolated across page origins including clear and restart", async () => {
        const gm = new Map(), a = fixture({ gm }), b = fixture({ gm, origin: "https://www.javbus.com" });
        await a.credential.set(CREDENTIAL_KEYS.webDavPassword, "legacy-password");
        await a.webdav.saveProfile({ url: "https://a.example/dav", username: "user-a", password: "password-a" });
        await b.webdav.saveProfile({ url: "https://b.example/dav", username: "user-b", password: "password-b" });
        await expect(a.webdav.getProfile()).resolves.toEqual({ url: "https://a.example/dav", username: "user-a", password: "password-a" });
        await expect(b.webdav.getProfile()).resolves.toEqual({ url: "https://b.example/dav", username: "user-b", password: "password-b" });
        await a.webdav.saveProfile({ password: "" });
        const restarted = fixture({ gm });
        await expect(restarted.webdav.getProfile()).resolves.toMatchObject({ password: "" });
        expect(gm.get(scopedKey(pageOrigin))).toMatchObject({ deleted: true });
        await expect(b.webdav.getProfile()).resolves.toMatchObject({ password: "password-b" });
        await expect(a.credential.get(CREDENTIAL_KEYS.webDavPassword)).resolves.toBe("legacy-password");
    });

    it("rejects a damaged scoped record without falling back or overwriting it", async () => {
        const test = fixture(), damaged = { schema: 2, id: "damaged", secret: "old", ciphertext: "invalid" };
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "legacy-password");
        test.gm.set(scopedKey(pageOrigin), damaged);
        await expect(test.webdav.getProfile()).rejects.toMatchObject({ code: "WEBDAV_CREDENTIAL_UNREADABLE" });
        await expect(test.webdav.saveProfile({ username: "changed" })).rejects.toMatchObject({ code: "WEBDAV_CREDENTIAL_UNREADABLE" });
        expect(test.gm.get(scopedKey(pageOrigin))).toEqual(damaged);
        expect(test.values.setting.webDavUsername).toBe("old-user");
    });

    it("permits an explicit replacement of a damaged credential", async () => {
        const test = fixture();
        test.gm.set(scopedKey(pageOrigin), { schema: 2, id: "damaged", ciphertext: "invalid" });
        await expect(test.webdav.saveProfile({ password: "replacement", username: "recovered" })).resolves.toMatchObject({ password: "replacement", username: "recovered" });
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ password: "replacement" });
    });

    it("restores the exact protected damaged record if replacement settings fail", async () => {
        const test = fixture(), damaged = { schema: 2, id: "damaged", ciphertext: "invalid" }, failure = new Error("settings unavailable");
        test.gm.set(scopedKey(pageOrigin), damaged);
        test.storage.set.mockRejectedValueOnce(failure);
        await expect(test.webdav.saveProfile({ password: "replacement", username: "changed" })).rejects.toBe(failure);
        expect(test.gm.get(scopedKey(pageOrigin))).toEqual(damaged);
        expect(test.values.setting.webDavUsername).toBe("old-user");
    });

    it("retains unreadable legacy data and refuses to create a scoped key", async () => {
        const test = fixture(), damaged = { schema: 2, id: "legacy-damaged", ciphertext: "invalid" };
        test.gm.set(CREDENTIAL_KEYS.webDavPassword, damaged);
        await expect(test.webdav.getProfile()).rejects.toThrow("重新输入密码并保存");
        expect(test.gm.get(CREDENTIAL_KEYS.webDavPassword)).toEqual(damaged);
        expect(test.gm.has(scopedKey(pageOrigin))).toBe(false);
        expect(test.credentialStorage.setValue).not.toHaveBeenCalled();
    });

    it("preserves the legacy source when a migration write fails verification", async () => {
        const test = fixture();
        await test.credential.set(CREDENTIAL_KEYS.webDavPassword, "legacy-password");
        const legacy = structuredClone(test.gm.get(CREDENTIAL_KEYS.webDavPassword));
        test.credentialStorage.setValue.mockImplementationOnce(() => {});
        await expect(test.webdav.getProfile()).rejects.toThrow("重新输入密码并保存");
        expect(test.gm.get(CREDENTIAL_KEYS.webDavPassword)).toEqual(legacy);
        expect(test.gm.has(scopedKey(pageOrigin))).toBe(false);
    });

    it("queues profile reads until the matching endpoint and password have committed", async () => {
        const test = fixture();
        await test.credential.set(scopedKey(pageOrigin), "old-password");
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const persist = test.storage.set.getMockImplementation();
        test.storage.set.mockImplementationOnce(async (...args) => { await gate; return persist(...args); });
        const saving = test.webdav.saveProfile({ url: "https://new.example/dav", password: "new-password" });
        await vi.waitFor(() => expect(test.storage.set).toHaveBeenCalledOnce());
        let readSettled = false;
        const reading = test.webdav.getProfile().then(profile => { readSettled = true; return profile; });
        await Promise.resolve();
        expect(readSettled).toBe(false);
        release();
        await saving;
        await expect(reading).resolves.toMatchObject({ url: "https://new.example/dav", password: "new-password" });
    });

    it("does not let an earlier failed save roll back a later successful password", async () => {
        const test = fixture();
        await test.credential.set(scopedKey(pageOrigin), "old-password");
        const original = structuredClone(test.gm.get(scopedKey(pageOrigin)));
        let rejectFirst;
        const gate = new Promise((_resolve, reject) => { rejectFirst = reject; });
        test.storage.set.mockImplementationOnce(() => gate);
        const first = test.webdav.saveProfile({ username: "first", password: "first-password" });
        const rejected = expect(first).rejects.toThrow("first persistence failure");
        await vi.waitFor(() => expect(test.storage.set).toHaveBeenCalledOnce());
        const second = test.webdav.saveProfile({ username: "second", password: "second-password" });
        rejectFirst(new Error("first persistence failure"));
        await rejected;
        await expect(second).resolves.toMatchObject({ username: "second", password: "second-password" });
        expect(test.gm.get(scopedKey(pageOrigin))).not.toEqual(original);
        await expect(test.webdav.getProfile()).resolves.toMatchObject({ username: "second", password: "second-password" });
    });

    it("reports rollback failures without claiming the profile was saved", async () => {
        const test = fixture();
        await test.credential.set(scopedKey(pageOrigin), "old-password");
        const oldRecord = test.gm.get(scopedKey(pageOrigin));
        const write = test.credentialStorage.setValue.getMockImplementation();
        test.credentialStorage.setValue.mockImplementation((key, record) => {
            if (record === oldRecord) throw new Error("restore failed");
            return write(key, record);
        });
        test.storage.set.mockRejectedValueOnce(new Error("settings failed"));
        await expect(test.webdav.saveProfile({ password: "new-password", username: "changed" })).rejects.toThrow("原记录恢复失败");
        expect(test.values.setting.webDavUsername).toBe("old-user");
    });

    it("uses the current page origin with the existing three-argument constructor", async () => {
        vi.stubGlobal("location", new URL(pageOrigin));
        const test = fixture(), webdav = new WebDavService({}, test.credential, test.settings);
        await webdav.saveProfile({ password: "page-password" });
        expect(test.gm.has(scopedKey(pageOrigin))).toBe(true);
        expect(test.gm.has(CREDENTIAL_KEYS.webDavPassword)).toBe(false);
    });
});
