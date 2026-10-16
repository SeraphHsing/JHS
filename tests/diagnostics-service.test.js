import { describe, expect, it } from "vitest";
import { DiagnosticsService } from "../src/services/diagnostics-service.js";

describe("diagnostic credential redaction", () => {
    it("redacts project credential fields recursively while retaining useful diagnostics", () => {
        const diagnostics = new DiagnosticsService();
        diagnostics.recordError({ source: "webdav", details: { webDavPassword: "synthetic-password", authorToken: "synthetic-author", jhs_appAuthorization: "synthetic-app", nested: [{ access_token: "synthetic-access", refreshToken: "synthetic-refresh", cookie: "synthetic-cookie" }], status: 401, tokenCount: 2 } });
        const error = diagnostics.exportSnapshot().errors[0];
        expect(error.details).toMatchObject({ webDavPassword: "[redacted]", authorToken: "[redacted]", jhs_appAuthorization: "[redacted]", status: 401, tokenCount: 2 });
        expect(JSON.stringify(error)).not.toMatch(/synthetic-/);
    });

    it("redacts URL credentials and repeated sensitive query parameters inside messages", () => {
        const diagnostics = new DiagnosticsService();
        diagnostics.recordError({ message: "failed https://synthetic-user:synthetic-pass@example.test/dav?access_token=synthetic-access&token=synthetic-first&token=synthetic-second&folder=JHS next https://example.test/?webDavPassword=synthetic-password" });
        const message = diagnostics.exportSnapshot().errors[0].message;
        expect(message).not.toMatch(/synthetic-/);
        expect(message).toContain("example.test/dav");
        expect(message).toContain("folder=JHS");
    });

    it("leaves ordinary URLs and non-sensitive error details intact", () => {
        const diagnostics = new DiagnosticsService(), message = "https://example.test/search?q=movie&page=2";
        diagnostics.recordError({ message, details: { domain: "example.test", status: 503, remainingSeconds: 20 } });
        expect(diagnostics.exportSnapshot().errors[0]).toMatchObject({ message, details: { domain: "example.test", status: 503, remainingSeconds: 20 } });
    });

    it("also protects malformed URLs and provider-health diagnostics", () => {
        const diagnostics = new DiagnosticsService();
        diagnostics.recordError({ message: "https://synthetic-user:synthetic-password@invalid[host]/?token=synthetic-token" });
        diagnostics.updateProvider("webdav", { ok: false, error: "https://example.test/?access_token=synthetic-access", webDavPassword: "synthetic-password" });
        const snapshot = diagnostics.exportSnapshot();
        expect(JSON.stringify(snapshot)).not.toMatch(/synthetic-/);
        expect(snapshot.providerHealth.webdav).toMatchObject({ ok: false, webDavPassword: "[redacted]" });
    });
});
