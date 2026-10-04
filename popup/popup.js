// Safe wrapper for chrome APIs to support standalone testing/preview
const storage = window.chrome?.storage?.local || {
    async get(keys) {
        try {
            const raw = localStorage.getItem("leetsync_mock_storage");
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    async set(items) {
        try {
            const raw = localStorage.getItem("leetsync_mock_storage");
            const current = raw ? JSON.parse(raw) : {};
            Object.assign(current, items);
            localStorage.setItem(
                "leetsync_mock_storage",
                JSON.stringify(current)
            );
        } catch (e) { }
    },

    async remove(keys) {
        try {
            const raw = localStorage.getItem("leetsync_mock_storage");
            const current = raw ? JSON.parse(raw) : {};
            const arr = Array.isArray(keys) ? keys : [keys];

            for (const k of arr) {
                delete current[k];
            }

            localStorage.setItem(
                "leetsync_mock_storage",
                JSON.stringify(current)
            );
        } catch (e) { }
    }
};


function sendMessage(msg, callback) {
    if (window.chrome?.runtime?.sendMessage) {
        window.chrome.runtime.sendMessage(msg, callback);
    } else {
        console.warn(
            "[LeetSync Mock] chrome.runtime.sendMessage called outside extension context:",
            msg
        );

        setTimeout(() => {
            if (callback) {
                callback({
                    success: true,
                    message: "Mock response"
                });
            }
        }, 100);
    }
}


document.addEventListener("DOMContentLoaded", async () => {

    // =========================================================
    // UI Elements - Connection & Alerts
    // =========================================================

    const connectionPill =
        document.getElementById("connection-pill");

    const connectionText =
        document.getElementById("connection-text");

    const authAlert =
        document.getElementById("auth-alert");

    const notificationBanner =
        document.getElementById("notification-banner");


    // =========================================================
    // UI Elements - Authentication
    // =========================================================

    const authConnectedView =
        document.getElementById("auth-connected-view");

    const authDisconnectedView =
        document.getElementById("auth-disconnected-view");

    const userLoginName =
        document.getElementById("user-login-name");

    const inputToken =
        document.getElementById("input-token");

    const btnConnectToken =
        document.getElementById("btn-connect-token");

    const btnDisconnect =
        document.getElementById("btn-disconnect");


    // =========================================================
    // UI Elements - OAuth
    // =========================================================

    const inputClientId =
        document.getElementById("input-client-id");

    const btnOauthLogin =
        document.getElementById("btn-oauth-login");


    // =========================================================
    // UI Elements - Repository
    // =========================================================

    const repoStatusPill =
        document.getElementById("repo-status-pill");

    const inputRepoOwner =
        document.getElementById("input-repo-owner");

    const inputRepoName =
        document.getElementById("input-repo-name");

    const btnSaveRepo =
        document.getElementById("btn-save-repo");

    const btnTestRepo =
        document.getElementById("btn-test-repo");

    const repoFeedback =
        document.getElementById("repo-feedback");


    // =========================================================
    // UI Elements - Sync
    // =========================================================

    const syncStatusBadge =
        document.getElementById("sync-status-badge");

    const syncProblemTitle =
        document.getElementById("sync-problem-title");

    const syncMessage =
        document.getElementById("sync-message");

    const syncTimestamp =
        document.getElementById("sync-timestamp");

    const syncLinkContainer =
        document.getElementById("sync-link-container");

    const syncGithubLink =
        document.getElementById("sync-github-link");


    // =========================================================
    // Notification Helper
    // =========================================================

    function showNotification(
        message,
        type = "success",
        durationMs = 3500
    ) {
        notificationBanner.textContent = message;
        notificationBanner.className =
            `banner banner-${type}`;

        notificationBanner.classList.remove("hidden");

        setTimeout(() => {
            notificationBanner.classList.add("hidden");
        }, durationMs);
    }


    // =========================================================
    // Time Formatter
    // =========================================================

    function formatTime(timestamp) {
        if (!timestamp) {
            return "—";
        }

        const diffMs = Date.now() - timestamp;
        const diffSecs = Math.floor(diffMs / 1000);

        if (diffSecs < 60) {
            return "Just now";
        }

        const diffMins = Math.floor(diffSecs / 60);

        if (diffMins < 60) {
            return `${diffMins}m ago`;
        }

        const diffHours = Math.floor(diffMins / 60);

        if (diffHours < 24) {
            return `${diffHours}h ago`;
        }

        return new Date(timestamp).toLocaleDateString();
    }


    // =========================================================
    // Load Extension State
    // =========================================================

    async function loadExtensionState() {

        const data = await storage.get([
            "githubToken",
            "githubUser",
            "githubRepo",
            "lastSyncStatus",
            "authRequired"
        ]);

        const isConnected =
            Boolean(data.githubToken);

        const authRequired =
            Boolean(data.authRequired);


        // -----------------------------------------------------
        // Connection & Authentication UI
        // -----------------------------------------------------

        if (isConnected) {

            connectionPill.className =
                "status-pill status-connected";

            connectionText.textContent =
                "Connected";

            authConnectedView.classList.remove("hidden");

            authDisconnectedView.classList.add("hidden");

            userLoginName.textContent =
                data.githubUser
                    ? `@${data.githubUser}`
                    : "@authenticated";

        } else {

            connectionPill.className =
                "status-pill status-disconnected";

            connectionText.textContent =
                "Disconnected";

            authConnectedView.classList.add("hidden");

            authDisconnectedView.classList.remove("hidden");
        }


        // -----------------------------------------------------
        // Authentication Alert
        // -----------------------------------------------------

        if (authRequired) {
            authAlert.classList.remove("hidden");
        } else {
            authAlert.classList.add("hidden");
        }


        // -----------------------------------------------------
        // Repository Configuration
        // -----------------------------------------------------

        const repo = data.githubRepo;

        if (repo && repo.owner && repo.repo) {

            inputRepoOwner.value =
                repo.owner;

            inputRepoName.value =
                repo.repo;

            repoStatusPill.className =
                "badge badge-success";

            repoStatusPill.textContent =
                "Configured";

        } else {

            inputRepoOwner.value =
                repo?.owner || "";

            inputRepoName.value =
                repo?.repo || "";

            repoStatusPill.className =
                "badge badge-neutral";

            repoStatusPill.textContent =
                "Not Configured";
        }


        // -----------------------------------------------------
        // Last Sync Activity
        // -----------------------------------------------------

        const sync = data.lastSyncStatus;

        if (sync) {

            syncProblemTitle.textContent =
                sync.problemTitle || "None yet";

            syncMessage.textContent =
                sync.message || "Ready";

            syncTimestamp.textContent =
                formatTime(sync.timestamp);


            if (sync.status === "created") {

                syncStatusBadge.className =
                    "badge badge-success";

                syncStatusBadge.textContent =
                    "Created";

            } else if (sync.status === "updated") {

                syncStatusBadge.className =
                    "badge badge-success";

                syncStatusBadge.textContent =
                    "Updated";

            } else if (sync.status === "skipped") {

                syncStatusBadge.className =
                    "badge badge-skipped";

                syncStatusBadge.textContent =
                    "Skipped";

            } else if (sync.status === "error") {

                syncStatusBadge.className =
                    "badge badge-error";

                syncStatusBadge.textContent =
                    "Error";

            } else {

                syncStatusBadge.className =
                    "badge badge-idle";

                syncStatusBadge.textContent =
                    "Idle";
            }


            if (sync.htmlUrl) {

                syncGithubLink.href =
                    sync.htmlUrl;

                syncLinkContainer.classList.remove(
                    "hidden"
                );

            } else {

                syncLinkContainer.classList.add(
                    "hidden"
                );
            }

        } else {

            syncStatusBadge.className =
                "badge badge-idle";

            syncStatusBadge.textContent =
                "Idle";

            syncProblemTitle.textContent =
                "None yet";

            syncMessage.textContent =
                "Waiting for accepted submission on LeetCode";

            syncTimestamp.textContent =
                "—";

            syncLinkContainer.classList.add(
                "hidden"
            );
        }
    }


    // =========================================================
    // Personal Access Token - Testing Fallback
    // =========================================================

    btnConnectToken.addEventListener(
        "click",
        async () => {

            const token =
                inputToken.value.trim();

            if (!token) {

                showNotification(
                    "Please enter a GitHub Personal Access Token.",
                    "error"
                );

                return;
            }


            btnConnectToken.disabled =
                true;

            btnConnectToken.textContent =
                "Verifying...";


            sendMessage(
                {
                    type: "SAVE_GITHUB_TOKEN",
                    payload: {
                        token: token
                    }
                },
                (response) => {

                    btnConnectToken.disabled =
                        false;

                    btnConnectToken.textContent =
                        "Connect GitHub";


                    if (
                        response &&
                        response.success
                    ) {

                        inputToken.value = "";

                        showNotification(
                            `Connected successfully as @${response.user}!`,
                            "success"
                        );

                        loadExtensionState();

                    } else {

                        const msg =
                            response?.message ||
                            "Failed to verify token with GitHub.";

                        showNotification(
                            msg,
                            "error"
                        );
                    }
                }
            );
        }
    );


    // =========================================================
    // Disconnect GitHub
    // =========================================================

    btnDisconnect.addEventListener(
        "click",
        () => {

            sendMessage(
                {
                    type: "DISCONNECT_GITHUB"
                },
                () => {

                    showNotification(
                        "Disconnected from GitHub.",
                        "success"
                    );

                    loadExtensionState();
                }
            );
        }
    );


    // =========================================================
    // Save Repository Configuration
    // =========================================================

    btnSaveRepo.addEventListener(
        "click",
        () => {

            const owner =
                inputRepoOwner.value.trim();

            const repo =
                inputRepoName.value.trim();


            if (!owner || !repo) {

                repoFeedback.className =
                    "feedback-text feedback-error";

                repoFeedback.textContent =
                    "Please fill in both owner and repo name.";

                repoFeedback.classList.remove(
                    "hidden"
                );

                return;
            }


            sendMessage(
                {
                    type: "SAVE_REPO_CONFIG",
                    payload: {
                        owner,
                        repo
                    }
                },
                (response) => {

                    if (
                        response &&
                        response.success
                    ) {

                        repoFeedback.className =
                            "feedback-text feedback-success";

                        repoFeedback.textContent =
                            `Saved target repo: ${owner}/${repo}`;

                        repoFeedback.classList.remove(
                            "hidden"
                        );

                        repoStatusPill.className =
                            "badge badge-success";

                        repoStatusPill.textContent =
                            "Configured";

                    } else {

                        repoFeedback.className =
                            "feedback-text feedback-error";

                        repoFeedback.textContent =
                            response?.message ||
                            "Failed to save configuration.";

                        repoFeedback.classList.remove(
                            "hidden"
                        );
                    }
                }
            );
        }
    );


    // =========================================================
    // Test Repository Access
    // =========================================================

    btnTestRepo.addEventListener(
        "click",
        () => {

            const owner =
                inputRepoOwner.value.trim();

            const repo =
                inputRepoName.value.trim();


            if (!owner || !repo) {

                repoFeedback.className =
                    "feedback-text feedback-error";

                repoFeedback.textContent =
                    "Enter owner and repo name first.";

                repoFeedback.classList.remove(
                    "hidden"
                );

                return;
            }


            btnTestRepo.disabled =
                true;

            btnTestRepo.textContent =
                "Testing...";

            repoFeedback.classList.add(
                "hidden"
            );


            sendMessage(
                {
                    type: "VALIDATE_REPO",
                    payload: {
                        owner,
                        repo
                    }
                },
                (response) => {

                    btnTestRepo.disabled =
                        false;

                    btnTestRepo.textContent =
                        "Test Access";


                    if (
                        response &&
                        response.success &&
                        response.exists
                    ) {

                        repoFeedback.className =
                            "feedback-text feedback-success";

                        repoFeedback.textContent =
                            `✓ Access confirmed to ${response.fullName} (push: ${response.canPush ? "allowed" : "denied"})`;

                        repoFeedback.classList.remove(
                            "hidden"
                        );

                    } else {

                        repoFeedback.className =
                            "feedback-text feedback-error";

                        repoFeedback.textContent =
                            `✗ ${response?.message || "Cannot access repository."}`;

                        repoFeedback.classList.remove(
                            "hidden"
                        );
                    }
                }
            );
        }
    );


    // =========================================================
    // OAuth 2.0 Login
    // =========================================================

    btnOauthLogin.addEventListener(
        "click",
        () => {

            const clientId =
                inputClientId.value.trim();


            if (!clientId) {

                showNotification(
                    "Please enter your GitHub OAuth App Client ID.",
                    "error"
                );

                return;
            }


            btnOauthLogin.disabled =
                true;

            btnOauthLogin.textContent =
                "Authorizing...";


            sendMessage(
                {
                    type: "LAUNCH_GITHUB_OAUTH",
                    payload: {
                        clientId
                    }
                },
                (response) => {

                    btnOauthLogin.disabled =
                        false;

                    btnOauthLogin.textContent =
                        "Authorize via OAuth";


                    if (
                        response &&
                        response.success
                    ) {

                        if (response.tokenAcquired) {

                            showNotification(
                                `Connected successfully as @${response.user}!`,
                                "success"
                            );

                            loadExtensionState();

                        } else {

                            showNotification(
                                "OAuth completed, but no access token was received.",
                                "error"
                            );
                        }

                    } else {

                        showNotification(
                            response?.message ||
                            "OAuth authorization failed.",
                            "error"
                        );
                    }
                }
            );
        }
    );


    // =========================================================
    // Initial Load
    // =========================================================

    await loadExtensionState();
});