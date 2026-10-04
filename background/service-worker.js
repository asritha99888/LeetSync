// LeetSync Service Worker (Manifest V3)
// Responsible for: authentication, GitHub API operations, storage/state, duplicate checking, and file commits.

console.log("[LeetSync] Service worker started.");

/**
 * Language to file extension mapping
 */
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

/**
 * Converts a string to base64 safely supporting full UTF-8 characters.
 */
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

/**
 * Decodes a base64 string to a UTF-8 string.
 */
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

/**
 * Determines file extension for given programming language.
 */
function getLanguageExtension(language) {
    if (!language) return "txt";
    const normalized = language.toLowerCase().trim();
    return EXTENSION_MAP[normalized] || "txt";
}

/**
 * Generates deterministic solution file path.
 * e.g., solutions/two-sum.py
 */
function getSolutionFilePath(problemSlug, language) {
    const ext = getLanguageExtension(language);
    const slug = problemSlug ? problemSlug.trim() : "unknown-problem";
    return `solutions/${slug}.${ext}`;
}

/**
 * Custom error classes for fine-grained error identification
 */
class GitHubAuthError extends Error {
    constructor(message = "GitHub authentication required or token expired (HTTP 401)") {
        super(message);
        this.name = "GitHubAuthError";
        this.status = 401;
    }
}

class GitHubApiError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "GitHubApiError";
        this.status = status;
    }
}

/**
 * Handles 401 Unauthorized errors by clearing stored token and notifying state.
 */
async function handleUnauthorizedError() {
    console.warn("[LeetSync] 401 Unauthorized encountered. Invalidation in progress.");
    await chrome.storage.local.remove(["githubToken", "githubUser"]);
    await chrome.storage.local.set({
        authRequired: true,
        lastSyncStatus: {
            status: "error",
            message: "Authentication required: GitHub token expired or invalid (HTTP 401). Please re-authenticate.",
            timestamp: Date.now()
        }
    });
}

/**
 * Fetches an existing file from the GitHub repository.
 * Returns { exists: true, sha, content } or { exists: false }
 */
async function getGitHubFile(token, owner, repo, path) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });

    if (response.status === 401) {
        await handleUnauthorizedError();
        throw new GitHubAuthError();
    }

    if (response.status === 404) {
        return { exists: false };
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new GitHubApiError(response.status, `GitHub GET file error (HTTP ${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const decodedContent = data.content ? base64ToUtf8(data.content) : "";

    return {
        exists: true,
        sha: data.sha,
        content: decodedContent,
        downloadUrl: data.html_url
    };
}

/**
 * Creates a new file in the GitHub repository.
 */
async function createGitHubFile(token, owner, repo, path, code, commitMessage) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: commitMessage,
        content: utf8ToBase64(code)
    };

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (response.status === 401) {
        await handleUnauthorizedError();
        throw new GitHubAuthError();
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new GitHubApiError(response.status, `GitHub create file error (HTTP ${response.status}): ${errorBody}`);
    }

    return await response.json();
}

/**
 * Updates an existing file in the GitHub repository using its existing SHA.
 */
async function updateGitHubFile(token, owner, repo, path, code, sha, commitMessage) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: commitMessage,
        content: utf8ToBase64(code),
        sha: sha
    };

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (response.status === 401) {
        await handleUnauthorizedError();
        throw new GitHubAuthError();
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new GitHubApiError(response.status, `GitHub update file error (HTTP ${response.status}): ${errorBody}`);
    }

    return await response.json();
}

/**
 * Validates token and retrieves user info from GitHub.
 */
async function validateGitHubToken(token) {
    const response = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });

    if (response.status === 401) {
        throw new GitHubAuthError("Invalid or expired GitHub token.");
    }

    if (!response.ok) {
        throw new GitHubApiError(response.status, `GitHub API error: HTTP ${response.status}`);
    }

    return await response.json();
}

/**
 * Validates that the configured repository exists and the user has push access.
 */
async function validateRepository(token, owner, repo) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });

    if (response.status === 401) {
        await handleUnauthorizedError();
        throw new GitHubAuthError();
    }

    if (response.status === 404) {
        return { exists: false, message: `Repository ${owner}/${repo} not found.` };
    }

    if (!response.ok) {
        throw new GitHubApiError(response.status, `Repository check error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const canPush = data.permissions ? data.permissions.push : true;
    return {
        exists: true,
        canPush: canPush,
        fullName: data.full_name,
        defaultBranch: data.default_branch
    };
}

/**
 * Synchronizes accepted LeetCode solution to GitHub.
 * Handles duplicate checking, SHA retrieval, and file creation/update.
 */
async function syncToGitHub(submissionData) {
    const { submissionId, problemTitle, problemSlug, language, code } = submissionData;

    console.log(`[LeetSync] Starting GitHub sync for submission ${submissionId} (${problemTitle})...`);

    // 1. Retrieve config and credentials from storage
    const storage = await chrome.storage.local.get([
        "githubToken",
        "githubRepo",
        "processedSubmissions"
    ]);

    const token = storage.githubToken;
    const repoConfig = storage.githubRepo;
    const processedSubmissions = storage.processedSubmissions || {};

    // 2. Check if this exact submission ID was already processed
    if (submissionId && processedSubmissions[submissionId]) {
        console.log(`[LeetSync] Submission ${submissionId} already processed previously. Skipping.`);
        return {
            success: true,
            status: "skipped",
            reason: "submission_already_processed",
            message: `Submission ${submissionId} has already been synced.`
        };
    }

    // 3. Verify GitHub authentication
    if (!token) {
        const errorMsg = "GitHub authentication required. Please connect your GitHub account in the LeetSync popup.";
        console.warn(`[LeetSync] ${errorMsg}`);
        await chrome.storage.local.set({
            authRequired: true,
            lastSyncStatus: {
                status: "error",
                message: errorMsg,
                problemTitle: problemTitle,
                timestamp: Date.now()
            }
        });
        return { success: false, error: "AUTH_REQUIRED", message: errorMsg };
    }

    // 4. Verify target repository configuration
    if (!repoConfig || !repoConfig.owner || !repoConfig.repo) {
        const errorMsg = "Target GitHub repository not configured. Please set owner and repo in the LeetSync popup.";
        console.warn(`[LeetSync] ${errorMsg}`);
        await chrome.storage.local.set({
            lastSyncStatus: {
                status: "error",
                message: errorMsg,
                problemTitle: problemTitle,
                timestamp: Date.now()
            }
        });
        return { success: false, error: "REPO_NOT_CONFIGURED", message: errorMsg };
    }

    const { owner, repo } = repoConfig;
    const filePath = getSolutionFilePath(problemSlug, language);

    try {
        // 5. Query existing file from GitHub
        console.log(`[LeetSync] Checking existing file at ${owner}/${repo}/${filePath}...`);
        const existingFile = await getGitHubFile(token, owner, repo, filePath);

        let result = null;

        if (!existingFile.exists) {
            // Case A: File does NOT exist -> Create new file!
            console.log(`[LeetSync] File does not exist. Creating new solution file...`);
            const commitMessage = `Add solution for ${problemTitle} [LeetSync]`;
            const createResult = await createGitHubFile(token, owner, repo, filePath, code, commitMessage);

            result = {
                success: true,
                status: "created",
                filePath: filePath,
                commitSha: createResult.commit ? createResult.commit.sha : null,
                htmlUrl: createResult.content ? createResult.content.html_url : null,
                message: `Successfully created ${filePath}`
            };
        } else {
            // Case B: File exists -> Retrieve existing content & compare
            const existingCode = existingFile.content || "";
            const isIdentical = existingCode.trim() === (code || "").trim();

            if (isIdentical) {
                // Identical solution -> DO NOT COMMIT
                console.log(`[LeetSync] Solution code is identical to existing file. Skipping GitHub commit.`);
                result = {
                    success: true,
                    status: "skipped",
                    reason: "identical_solution",
                    filePath: filePath,
                    message: `Solution identical to existing file. Commit skipped.`
                };
            } else {
                // Different solution -> Update GitHub file using existing SHA
                console.log(`[LeetSync] Solution differs from existing file. Updating via SHA ${existingFile.sha}...`);
                const commitMessage = `Update solution for ${problemTitle} [LeetSync]`;
                const updateResult = await updateGitHubFile(token, owner, repo, filePath, code, existingFile.sha, commitMessage);

                result = {
                    success: true,
                    status: "updated",
                    filePath: filePath,
                    commitSha: updateResult.commit ? updateResult.commit.sha : null,
                    htmlUrl: updateResult.content ? updateResult.content.html_url : null,
                    message: `Successfully updated ${filePath}`
                };
            }
        }

        // 6. Record processed submission ID in storage to prevent re-processing
        if (submissionId) {
            processedSubmissions[submissionId] = Date.now();
            await chrome.storage.local.set({ processedSubmissions });
        }

        // 7. Update last sync status for the popup
        await chrome.storage.local.set({
            authRequired: false,
            lastSyncStatus: {
                status: result.status,
                message: result.message,
                problemTitle: problemTitle,
                problemSlug: problemSlug,
                filePath: filePath,
                htmlUrl: result.htmlUrl || null,
                timestamp: Date.now()
            }
        });

        console.log(`[LeetSync] GitHub sync complete:`, result);
        return result;

    } catch (err) {
        console.error(`[LeetSync] GitHub sync error:`, err);

        let errorMessage = err.message || "An error occurred while syncing to GitHub.";

        if (err instanceof GitHubAuthError || err.status === 401) {
            errorMessage = "Authentication required: GitHub token expired or invalid (HTTP 401). Please re-authenticate.";
        } else if (err.status === 403) {
            errorMessage = "GitHub API rate limit exceeded or missing 'repo' permissions.";
        } else if (err.status === 404) {
            errorMessage = `GitHub repository ${owner}/${repo} not found or no access.`;
        }

        await chrome.storage.local.set({
            lastSyncStatus: {
                status: "error",
                message: errorMessage,
                problemTitle: problemTitle,
                problemSlug: problemSlug,
                timestamp: Date.now()
            }
        });

        return {
            success: false,
            error: err.name || "SYNC_ERROR",
            status: err.status || null,
            message: errorMessage
        };
    }
}

/**
 * Message dispatcher for content script and popup requests
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { type, payload } = request;

    if (type === "LEETCODE_SUBMISSION_ACCEPTED") {
        syncToGitHub(payload).then(sendResponse);
        return true; // Keep message channel open for asynchronous response
    }

    if (type === "SAVE_GITHUB_TOKEN") {
        validateGitHubToken(payload.token)
            .then(async (userData) => {
                await chrome.storage.local.set({
                    githubToken: payload.token,
                    githubUser: userData.login,
                    authRequired: false
                });
                sendResponse({ success: true, user: userData.login });
            })
            .catch((err) => {
                sendResponse({ success: false, message: err.message });
            });
        return true;
    }

    if (type === "DISCONNECT_GITHUB") {
        chrome.storage.local.remove(["githubToken", "githubUser"]).then(() => {
            chrome.storage.local.set({ authRequired: false }).then(() => {
                sendResponse({ success: true });
            });
        });
        return true;
    }

    if (type === "SAVE_REPO_CONFIG") {
        const { owner, repo } = payload;
        chrome.storage.local.set({ githubRepo: { owner: owner.trim(), repo: repo.trim() } })
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, message: err.message }));
        return true;
    }

    if (type === "VALIDATE_REPO") {
        chrome.storage.local.get(["githubToken", "githubRepo"]).then(async (data) => {
            if (!data.githubToken) {
                sendResponse({ success: false, message: "GitHub authentication required." });
                return;
            }
            const repoConfig = payload || data.githubRepo;
            if (!repoConfig || !repoConfig.owner || !repoConfig.repo) {
                sendResponse({ success: false, message: "Owner and Repo name required." });
                return;
            }
            try {
                const res = await validateRepository(data.githubToken, repoConfig.owner, repoConfig.repo);
                sendResponse({ success: true, ...res });
            } catch (err) {
                sendResponse({ success: false, message: err.message });
            }
        });
        return true;
    }

    if (type === "GET_REDIRECT_URI") {
        const redirectUri = chrome.identity.getRedirectURL("github");
        sendResponse({ success: true, redirectUri: redirectUri });
        return true;
    }

    if (type === "LAUNCH_GITHUB_OAUTH") {
        const { clientId } = payload || {};

        if (!clientId) {
            sendResponse({
                success: false,
                message: "Client ID required for OAuth flow."
            });
            return;
        }

        (async () => {
            const redirectUri = chrome.identity.getRedirectURL("github");

            console.log(
                `[LeetSync:OAuth] Starting OAuth with redirect URI: ${redirectUri}`
            );

            function randomString(length = 64) {
                const bytes = new Uint8Array(length);
                crypto.getRandomValues(bytes);

                return Array.from(bytes, byte =>
                    String.fromCharCode(65 + (byte % 26))
                ).join("");
            }

            function base64UrlEncode(bytes) {
                let binary = "";

                for (const byte of bytes) {
                    binary += String.fromCharCode(byte);
                }

                return btoa(binary)
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=+$/, "");
            }

            async function createCodeChallenge(verifier) {
                const data = new TextEncoder().encode(verifier);

                const digest = await crypto.subtle.digest(
                    "SHA-256",
                    data
                );

                return base64UrlEncode(new Uint8Array(digest));
            }

            try {
                // 1. Generate OAuth security values
                const state = randomString(32);
                const codeVerifier = randomString(64);
                const codeChallenge =
                    await createCodeChallenge(codeVerifier);

                // 2. Store temporary OAuth values
                await chrome.storage.local.set({
                    oauthState: state,
                    oauthCodeVerifier: codeVerifier
                });

                // 3. Build GitHub authorization URL
                const params = new URLSearchParams({
                    client_id: clientId,
                    redirect_uri: redirectUri,
                    scope: "repo",
                    state: state,
                    code_challenge: codeChallenge,
                    code_challenge_method: "S256"
                });

                const authUrl =
                    `https://github.com/login/oauth/authorize?${params.toString()}`;
                console.log("[LeetSync:OAuth] Auth URL:", authUrl);
                console.log(
                    "[LeetSync:OAuth] Launching GitHub authorization..."
                );

                // 4. Open GitHub login/authorization page
                chrome.identity.launchWebAuthFlow(
                    {
                        url: authUrl,
                        interactive: true
                    },
                    async (redirectUrl) => {
                        try {
                            if (chrome.runtime.lastError) {
                                throw new Error(
                                    chrome.runtime.lastError.message ||
                                    "OAuth authorization failed."
                                );
                            }

                            if (!redirectUrl) {
                                throw new Error(
                                    "GitHub OAuth did not return a redirect URL."
                                );
                            }

                            // 5. Parse GitHub callback
                            const callbackUrl = new URL(redirectUrl);

                            const oauthError =
                                callbackUrl.searchParams.get("error");

                            if (oauthError) {
                                const description =
                                    callbackUrl.searchParams.get(
                                        "error_description"
                                    ) || oauthError;

                                throw new Error(
                                    `GitHub authorization failed: ${description}`
                                );
                            }

                            const returnedState =
                                callbackUrl.searchParams.get("state");

                            const code =
                                callbackUrl.searchParams.get("code");

                            // 6. Validate OAuth state
                            const storedState =
                                await chrome.storage.local.get([
                                    "oauthState"
                                ]);

                            if (
                                !storedState.oauthState ||
                                returnedState !== storedState.oauthState
                            ) {
                                throw new Error(
                                    "OAuth state validation failed."
                                );
                            }

                            if (!code) {
                                throw new Error(
                                    "No authorization code returned from GitHub."
                                );
                            }

                            // 7. Retrieve PKCE verifier
                            const storedVerifier =
                                await chrome.storage.local.get([
                                    "oauthCodeVerifier"
                                ]);

                            const codeVerifier =
                                storedVerifier.oauthCodeVerifier;

                            if (!codeVerifier) {
                                throw new Error(
                                    "OAuth PKCE verifier is missing."
                                );
                            }

                            console.log(
                                "[LeetSync:OAuth] Authorization code received. Exchanging for access token..."
                            );

                            // 8. Exchange authorization code for access token
                            // 8. Exchange authorization code through the secure OAuth server
                            const tokenResponse = await fetch(
                                "http://localhost:3000/oauth/github/exchange",
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json"
                                    },
                                    body: JSON.stringify({
                                        clientId,
                                        code,
                                        redirectUri,
                                        codeVerifier
                                    })
                                }
                            );

                            const tokenData = await tokenResponse.json();

                            if (!tokenResponse.ok) {
                                throw new Error(
                                    tokenData.error ||
                                    `OAuth token exchange failed (HTTP ${tokenResponse.status}).`
                                );
                            }

                            if (!tokenData.access_token) {
                                throw new Error(
                                    "OAuth server did not return an access token."
                                );
                            }

                            // 9. Validate token with GitHub
                            const userData =
                                await validateGitHubToken(
                                    tokenData.access_token
                                );

                            // 10. Store authenticated account
                            await chrome.storage.local.set({
                                githubToken: tokenData.access_token,
                                githubUser: userData.login,
                                authRequired: false
                            });

                            // 11. Remove temporary OAuth values
                            await chrome.storage.local.remove([
                                "oauthState",
                                "oauthCodeVerifier"
                            ]);

                            console.log(
                                `[LeetSync:OAuth] Successfully authenticated as @${userData.login}.`
                            );

                            sendResponse({
                                success: true,
                                user: userData.login,
                                tokenAcquired: true
                            });

                        } catch (error) {
                            console.error(
                                "[LeetSync:OAuth] OAuth callback failed:",
                                error
                            );

                            await chrome.storage.local.remove([
                                "oauthState",
                                "oauthCodeVerifier"
                            ]);

                            sendResponse({
                                success: false,
                                message:
                                    error.message ||
                                    "GitHub OAuth authentication failed."
                            });
                        }
                    }
                );

            } catch (error) {
                console.error(
                    "[LeetSync:OAuth] Failed to initialize OAuth:",
                    error
                );

                await chrome.storage.local.remove([
                    "oauthState",
                    "oauthCodeVerifier"
                ]);

                sendResponse({
                    success: false,
                    message:
                        error.message ||
                        "Unable to start GitHub OAuth."
                });
            }
        })();

        // IMPORTANT:
        // Keep the message channel open while the async OAuth flow runs.
        return true;
    }

    return false;
});