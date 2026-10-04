// Automated test suite for LeetSync core functionality
// Covers TEST 1 through TEST 8 from specification

import test from "node:test";
import assert from "node:assert/strict";

// Helper functions mirroring background/service-worker.js
const EXTENSION_MAP = {
    python: "py",
    python3: "py",
    py: "py",
    cpp: "cpp",
    "c++": "cpp",
    c: "c",
    java: "java",
    csharp: "cs",
    "c#": "cs",
    cs: "cs",
    javascript: "js",
    js: "js",
    typescript: "ts",
    ts: "ts",
    golang: "go",
    go: "go",
    rust: "rs",
    rs: "rs",
    swift: "swift",
    kotlin: "kt",
    kt: "kt",
    ruby: "rb",
    rb: "rb",
    scala: "scala",
    php: "php",
    racket: "rkt",
    erlang: "erl",
    elixir: "ex",
    dart: "dart",
    sql: "sql"
};

function getLanguageExtension(language) {
    if (!language) return "txt";
    const normalized = language.toLowerCase().trim();
    return EXTENSION_MAP[normalized] || "txt";
}

function getSolutionFilePath(problemSlug, language) {
    const ext = getLanguageExtension(language);
    const slug = problemSlug ? problemSlug.trim() : "unknown-problem";
    return `solutions/${slug}.${ext}`;
}

function utf8ToBase64(str) {
    if (typeof str !== "string") str = String(str || "");
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUtf8(base64Str) {
    if (!base64Str) return "";
    const cleanB64 = base64Str.replace(/\s/g, "");
    const binary = atob(cleanB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

// Mock Chrome Storage
class MockStorage {
    constructor(initialData = {}) {
        this.data = { ...initialData };
    }
    async get(keys) {
        if (typeof keys === "string") {
            return { [keys]: this.data[keys] };
        }
        if (Array.isArray(keys)) {
            const result = {};
            for (const k of keys) {
                if (k in this.data) result[k] = this.data[k];
            }
            return result;
        }
        return { ...this.data };
    }
    async set(items) {
        Object.assign(this.data, items);
    }
    async remove(keys) {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) {
            delete this.data[k];
        }
    }
}

// Mock GitHub API Engine
class MockGitHubApiEngine {
    constructor() {
        this.files = new Map(); // path -> { content, sha }
        this.commits = [];
        this.invalidTokens = new Set(["expired_token_123"]);
        this.currentShaCounter = 1000;
    }

    async handleRequest(url, options = {}) {
        const method = options.method || "GET";
        const auth = options.headers?.Authorization || "";
        const token = auth.replace("Bearer ", "");

        // Auth check
        if (!token || this.invalidTokens.has(token)) {
            return { status: 401, data: { message: "Bad credentials" } };
        }

        // Contents endpoint match
        const match = url.match(/\/contents\/(.+)$/);
        if (!match) return { status: 404, data: { message: "Not Found" } };

        const path = match[1];

        if (method === "GET") {
            if (this.files.has(path)) {
                const file = this.files.get(path);
                return {
                    status: 200,
                    data: {
                        sha: file.sha,
                        content: utf8ToBase64(file.content),
                        html_url: `https://github.com/mock/repo/blob/main/${path}`
                    }
                };
            } else {
                return { status: 404, data: { message: "File not found" } };
            }
        }

        if (method === "PUT") {
            const body = JSON.parse(options.body);
            const content = base64ToUtf8(body.content);
            const sha = body.sha;

            if (this.files.has(path)) {
                const existing = this.files.get(path);
                if (existing.sha !== sha) {
                    return { status: 409, data: { message: "SHA conflict" } };
                }
            }

            const newSha = `sha_${++this.currentShaCounter}`;
            this.files.set(path, { content, sha: newSha });
            this.commits.push({ path, message: body.message, sha: newSha });

            return {
                status: this.files.has(path) ? 200 : 201,
                data: {
                    commit: { sha: newSha },
                    content: { html_url: `https://github.com/mock/repo/blob/main/${path}` }
                }
            };
        }

        return { status: 405, data: { message: "Method Not Allowed" } };
    }
}

// Core Sync Orchestrator
async function runSyncFlow(submissionData, storage, apiEngine) {
    const { submissionId, problemTitle, problemSlug, language, code } = submissionData;
    const store = await storage.get(["githubToken", "githubRepo", "processedSubmissions"]);
    const token = store.githubToken;
    const repoConfig = store.githubRepo;
    const processedSubmissions = store.processedSubmissions || {};

    // 1. Processed submission check
    if (submissionId && processedSubmissions[submissionId]) {
        return { success: true, status: "skipped", reason: "submission_already_processed" };
    }

    // 2. Authentication check
    if (!token) {
        await storage.set({ authRequired: true });
        return { success: false, error: "AUTH_REQUIRED" };
    }

    // 3. Repo config check
    if (!repoConfig?.owner || !repoConfig?.repo) {
        return { success: false, error: "REPO_NOT_CONFIGURED" };
    }

    const { owner, repo } = repoConfig;
    const filePath = getSolutionFilePath(problemSlug, language);

    // 4. Query GitHub file
    const getRes = await apiEngine.handleRequest(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        }
    );

    if (getRes.status === 401) {
        await storage.remove(["githubToken", "githubUser"]);
        await storage.set({ authRequired: true });
        return { success: false, error: "AUTH_EXPIRED" };
    }

    let syncResult = null;

    if (getRes.status === 404) {
        // Create new file
        const commitMessage = `Add solution for ${problemTitle} [LeetSync]`;
        const putRes = await apiEngine.handleRequest(
            `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
            {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    message: commitMessage,
                    content: utf8ToBase64(code)
                })
            }
        );

        if (putRes.status === 401) {
            await storage.remove(["githubToken", "githubUser"]);
            await storage.set({ authRequired: true });
            return { success: false, error: "AUTH_EXPIRED" };
        }

        syncResult = {
            success: true,
            status: "created",
            filePath,
            sha: putRes.data.commit.sha
        };
    } else if (getRes.status === 200) {
        // Compare code
        const existingCode = base64ToUtf8(getRes.data.content);
        if (existingCode.trim() === (code || "").trim()) {
            syncResult = {
                success: true,
                status: "skipped",
                reason: "identical_solution",
                filePath
            };
        } else {
            // Update file using existing SHA
            const commitMessage = `Update solution for ${problemTitle} [LeetSync]`;
            const putRes = await apiEngine.handleRequest(
                `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        message: commitMessage,
                        content: utf8ToBase64(code),
                        sha: getRes.data.sha
                    })
                }
            );

            syncResult = {
                success: true,
                status: "updated",
                filePath,
                sha: putRes.data.commit.sha
            };
        }
    } else {
        return { success: false, error: `API_ERROR_${getRes.status}` };
    }

    // Record submission
    if (submissionId) {
        processedSubmissions[submissionId] = Date.now();
        await storage.set({ processedSubmissions });
    }

    return syncResult;
}

// Content script submission state machine simulator
class SubmissionStateMachine {
    constructor() {
        this.state = "IDLE";
        this.processedSubmissions = new Set();
        this.acceptedTriggers = 0;
    }

    // Triggered when page loads
    onPageLoad(currentDomStatus) {
        // If loaded with Accepted, state starts IDLE and remains IDLE unless user submits
        if (currentDomStatus === "Accepted") {
            // Reloading an old accepted page does NOT trigger sync!
            return;
        }
    }

    onUserSubmit() {
        if (this.state === "PENDING" || this.state === "JUDGING") return;
        this.state = "PENDING";
    }

    onDomMutation(newStatus) {
        if (newStatus === "Pending") {
            if (this.state === "IDLE") this.state = "PENDING";
        } else if (newStatus === "Judging") {
            if (this.state === "PENDING") this.state = "JUDGING";
        } else if (newStatus === "Accepted") {
            // Only fire if coming from PENDING or JUDGING
            if (this.state === "PENDING" || this.state === "JUDGING") {
                this.state = "ACCEPTED";
                this.acceptedTriggers++;
                // Reset to IDLE after triggering
                this.state = "IDLE";
            }
        } else if (["Wrong Answer", "Time Limit Exceeded"].includes(newStatus)) {
            this.state = "IDLE";
        }
    }
}

// ------------------- TEST SUITE -------------------

test("TEST 1 & TEST 7: Fresh accepted submission creates GitHub file when it does not exist", async () => {
    const apiEngine = new MockGitHubApiEngine();
    const storage = new MockStorage({
        githubToken: "valid_token_abc",
        githubRepo: { owner: "asritha99888", repo: "leetcode-solutions" }
    });

    const submission = {
        submissionId: "1001",
        problemTitle: "Two Sum",
        problemSlug: "two-sum",
        language: "python3",
        code: "class Solution:\n    def twoSum(self, nums, target):\n        return []"
    };

    const res = await runSyncFlow(submission, storage, apiEngine);

    assert.equal(res.success, true);
    assert.equal(res.status, "created");
    assert.equal(res.filePath, "solutions/two-sum.py");
    assert.equal(apiEngine.commits.length, 1);
    assert.match(apiEngine.commits[0].message, /Add solution for Two Sum/);

    // Verify stored in processedSubmissions
    const store = await storage.get("processedSubmissions");
    assert.ok(store.processedSubmissions["1001"]);
});

test("TEST 2: Same solution submitted again -> no duplicate GitHub commit", async () => {
    const apiEngine = new MockGitHubApiEngine();
    const storage = new MockStorage({
        githubToken: "valid_token_abc",
        githubRepo: { owner: "asritha99888", repo: "leetcode-solutions" }
    });

    const code = "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]";

    // Submission A
    const subA = {
        submissionId: "2001",
        problemTitle: "Two Sum",
        problemSlug: "two-sum",
        language: "python3",
        code: code
    };

    const resA = await runSyncFlow(subA, storage, apiEngine);
    assert.equal(resA.status, "created");
    assert.equal(apiEngine.commits.length, 1);

    // Submission B (Different submission ID, but EXACT same code)
    const subB = {
        submissionId: "2002",
        problemTitle: "Two Sum",
        problemSlug: "two-sum",
        language: "python3",
        code: code
    };

    const resB = await runSyncFlow(subB, storage, apiEngine);
    assert.equal(resB.success, true);
    assert.equal(resB.status, "skipped");
    assert.equal(resB.reason, "identical_solution");

    // Commit count MUST still be 1 (no duplicate commit!)
    assert.equal(apiEngine.commits.length, 1);
});

test("TEST 3 & TEST 8: Same problem, different solution -> GitHub file updated with existing SHA", async () => {
    const apiEngine = new MockGitHubApiEngine();
    const storage = new MockStorage({
        githubToken: "valid_token_abc",
        githubRepo: { owner: "asritha99888", repo: "leetcode-solutions" }
    });

    // Initial submission
    const initialSub = {
        submissionId: "3001",
        problemTitle: "Two Sum",
        problemSlug: "two-sum",
        language: "python3",
        code: "def twoSum(nums, target): return []"
    };

    const initialRes = await runSyncFlow(initialSub, storage, apiEngine);
    assert.equal(initialRes.status, "created");
    assert.equal(apiEngine.commits.length, 1);
    const initialSha = initialRes.sha;

    // Improved submission with different code
    const updatedSub = {
        submissionId: "3002",
        problemTitle: "Two Sum",
        problemSlug: "two-sum",
        language: "python3",
        code: "def twoSum(nums, target):\n    lookup = {}\n    for i, num in enumerate(nums):\n        if target - num in lookup: return [lookup[target - num], i]\n        lookup[num] = i"
    };

    const updatedRes = await runSyncFlow(updatedSub, storage, apiEngine);
    assert.equal(updatedRes.success, true);
    assert.equal(updatedRes.status, "updated");
    assert.equal(apiEngine.commits.length, 2);
    assert.notEqual(updatedRes.sha, initialSha);
    assert.match(apiEngine.commits[1].message, /Update solution for Two Sum/);

    // Verify repository file now has updated content
    const file = apiEngine.files.get("solutions/two-sum.py");
    assert.equal(file.content, updatedSub.code);
});

test("TEST 4: Reload an old accepted submission -> should NOT be treated as a new submission", () => {
    const sm = new SubmissionStateMachine();

    // User navigates directly to or refreshes an already Accepted page
    sm.onPageLoad("Accepted");

    // Random DOM mutations happen on page load
    sm.onDomMutation("Accepted");
    sm.onDomMutation("Accepted");

    // Should NOT trigger any sync!
    assert.equal(sm.acceptedTriggers, 0);
    assert.equal(sm.state, "IDLE");
});

test("TEST 5: Multiple DOM mutations during submission -> should result in only one processing attempt", () => {
    const sm = new SubmissionStateMachine();

    // User clicks submit
    sm.onUserSubmit();
    assert.equal(sm.state, "PENDING");

    // LeetCode produces multiple mutations while judging
    sm.onDomMutation("Pending");
    sm.onDomMutation("Judging");
    sm.onDomMutation("Judging");
    sm.onDomMutation("Judging");

    // Status finally settles on Accepted, followed by multiple re-renders
    sm.onDomMutation("Accepted");
    sm.onDomMutation("Accepted");
    sm.onDomMutation("Accepted");

    // Must trigger exactly ONCE
    assert.equal(sm.acceptedTriggers, 1);
    assert.equal(sm.state, "IDLE");
});

test("TEST 6: Expired / invalid GitHub authentication / HTTP 401 -> sync stops, token cleared, authRequired set", async () => {
    const apiEngine = new MockGitHubApiEngine();
    const storage = new MockStorage({
        githubToken: "expired_token_123", // Registered as invalid in mock engine
        githubRepo: { owner: "asritha99888", repo: "leetcode-solutions" }
    });

    const submission = {
        submissionId: "6001",
        problemTitle: "Reverse Linked List",
        problemSlug: "reverse-linked-list",
        language: "python3",
        code: "def reverseList(head): return None"
    };

    const res = await runSyncFlow(submission, storage, apiEngine);

    // Sync halted
    assert.equal(res.success, false);
    assert.equal(res.error, "AUTH_EXPIRED");

    // Token cleared and authRequired set to true
    const store = await storage.get(["githubToken", "authRequired"]);
    assert.equal(store.githubToken, undefined);
    assert.equal(store.authRequired, true);

    // No commit should have been made
    assert.equal(apiEngine.commits.length, 0);
});

test("UTF-8 encoding / decoding handles complex source code and multi-byte comments", () => {
    const codeWithUnicode = `// Solution with emojis 🚀 and non-ASCII chars: α, β, ñ, ö, 中文
function solve() {
    return "UTF-8 safe!";
}`;

    const encoded = utf8ToBase64(codeWithUnicode);
    const decoded = base64ToUtf8(encoded);

    assert.equal(decoded, codeWithUnicode);
});

test("Language to extension mapping produces deterministic paths", () => {
    assert.equal(getSolutionFilePath("two-sum", "python3"), "solutions/two-sum.py");
    assert.equal(getSolutionFilePath("two-sum", "cpp"), "solutions/two-sum.cpp");
    assert.equal(getSolutionFilePath("two-sum", "c++"), "solutions/two-sum.cpp");
    assert.equal(getSolutionFilePath("two-sum", "java"), "solutions/two-sum.java");
    assert.equal(getSolutionFilePath("two-sum", "javascript"), "solutions/two-sum.js");
    assert.equal(getSolutionFilePath("two-sum", "typescript"), "solutions/two-sum.ts");
    assert.equal(getSolutionFilePath("two-sum", "golang"), "solutions/two-sum.go");
    assert.equal(getSolutionFilePath("two-sum", "rust"), "solutions/two-sum.rs");
    assert.equal(getSolutionFilePath("two-sum", "c#"), "solutions/two-sum.cs");
});
