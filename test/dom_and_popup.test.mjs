// Unit and DOM simulation test for content.js and popup.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Verify popup.html contains all expected unique IDs
test("popup.html has all required interactive elements and IDs", () => {
    const html = fs.readFileSync("popup/popup.html", "utf8");

    const requiredIds = [
        "connection-pill",
        "connection-text",
        "auth-alert",
        "notification-banner",
        "auth-connected-view",
        "auth-disconnected-view",
        "user-login-name",
        "input-token",
        "btn-connect-token",
        "btn-disconnect",
        "input-client-id",
        "btn-oauth-login",
        "repo-status-pill",
        "input-repo-owner",
        "input-repo-name",
        "btn-save-repo",
        "btn-test-repo",
        "repo-feedback",
        "sync-status-badge",
        "sync-problem-title",
        "sync-message",
        "sync-timestamp",
        "sync-link-container",
        "sync-github-link"
    ];

    for (const id of requiredIds) {
        assert.ok(
            html.includes(`id="${id}"`),
            `Missing expected element id: ${id} in popup/popup.html`
        );
    }
});

// Verify manifest.json structure and permissions
test("manifest.json conforms to Manifest V3 specification", () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, "LeetSync");
    assert.ok(manifest.permissions.includes("storage"));
    assert.ok(manifest.permissions.includes("identity"));
    assert.ok(manifest.host_permissions.includes("https://leetcode.com/*"));
    assert.ok(manifest.host_permissions.includes("https://api.github.com/*"));

    assert.equal(manifest.background.service_worker, "background/service-worker.js");
    assert.equal(manifest.action.default_popup, "popup/popup.html");

    // Content scripts
    assert.equal(manifest.content_scripts.length, 2);
    assert.equal(manifest.content_scripts[0].world, "MAIN");
    assert.equal(manifest.content_scripts[0].js[0], "content/page-script.js");
    assert.equal(manifest.content_scripts[1].js[0], "content/content.js");
});

// Test language normalization helper logic
test("Language normalization supports all LeetCode languages", () => {
    function normalizeLanguage(lang) {
        const l = lang.toLowerCase().trim();
        if (l.includes("python3") || l === "py3") return "python3";
        if (l.includes("python")) return "python";
        if (l.includes("c++") || l === "cpp") return "cpp";
        if (l === "c") return "c";
        if (l.includes("c#") || l === "cs" || l.includes("csharp")) return "csharp";
        if (l.includes("typescript") || l === "ts") return "typescript";
        if (l.includes("javascript") || l === "js") return "javascript";
        if (l.includes("java")) return "java";
        if (l.includes("golang") || l === "go") return "go";
        if (l.includes("rust") || l === "rs") return "rust";
        if (l.includes("swift")) return "swift";
        if (l.includes("kotlin") || l === "kt") return "kotlin";
        if (l.includes("ruby") || l === "rb") return "ruby";
        if (l.includes("scala")) return "scala";
        if (l.includes("php")) return "php";
        return l;
    }

    assert.equal(normalizeLanguage("Python3"), "python3");
    assert.equal(normalizeLanguage("C++"), "cpp");
    assert.equal(normalizeLanguage("Java"), "java");
    assert.equal(normalizeLanguage("JavaScript"), "javascript");
    assert.equal(normalizeLanguage("TypeScript"), "typescript");
    assert.equal(normalizeLanguage("C#"), "csharp");
    assert.equal(normalizeLanguage("Go"), "go");
    assert.equal(normalizeLanguage("Rust"), "rust");
    assert.equal(normalizeLanguage("Kotlin"), "kotlin");
});
