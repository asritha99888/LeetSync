// LeetSync Content Script
// Runs on https://leetcode.com/problems/*

console.log("[LeetSync] Content script loaded.");

// In-memory set of processed submission IDs in this tab session
const processedSubmissionIds = new Set();

// State machine for submission tracking: "IDLE" | "PENDING" | "JUDGING" | "ACCEPTED"
let submissionState = "IDLE";
let isProcessing = false;
let statusObserver = null;
let statusObserverTimeout = null;
let lastDetectedSubmissionId = null;

// Track URL changes in LeetCode SPA
let lastUrl = window.location.href;

setInterval(() => {
    if (window.location.href !== lastUrl) {
        const oldUrl = lastUrl;
        lastUrl = window.location.href;
        console.log(`[LeetSync:SPA] URL changed from "${oldUrl}" to "${lastUrl}"`);

        // Check if new URL contains submission ID
        const match = lastUrl.match(/\/submissions\/(\d+)/);
        if (match && match[1]) {
            lastDetectedSubmissionId = match[1];
            console.log(`[LeetSync:SPA] Extracted submission ID from URL transition: ${lastDetectedSubmissionId}`);
        }
    }
}, 300);

/**
 * Searches for a current submission status indicator in the DOM.
 * Targets specific status elements to avoid matching acceptance statistics or unrelated text.
 */
function findSubmissionStatus() {
    const candidateSelectors = [
        ".medium.whitespace-nowrap.font-medium",
        "[data-e2e-locator='submission-result']",
        "span[data-state]",
        "div[class*='text-green-']",
        "div[class*='text-red-']",
        "span[class*='text-green-']",
        "span[class*='text-red-']"
    ];

    for (const selector of candidateSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            const rawText = element.textContent ? element.textContent.trim() : "";
            const lowerText = rawText.toLowerCase();

            if (lowerText === "pending" || lowerText === "pending..") {
                return { element, status: "Pending" };
            }
            if (lowerText === "judging") {
                return { element, status: "Judging" };
            }
            if (lowerText === "accepted") {
                // Verify it's not problem acceptance stats ("Acceptance Rate", etc.)
                const parentText = element.parentElement ? element.parentElement.textContent.toLowerCase() : "";
                if (!parentText.includes("acceptance rate") && !parentText.includes("acceptance :")) {
                    return { element, status: "Accepted" };
                }
            }
            if (lowerText === "wrong answer") {
                return { element, status: "Wrong Answer" };
            }
            if (lowerText === "time limit exceeded") {
                return { element, status: "Time Limit Exceeded" };
            }
            if (lowerText === "memory limit exceeded") {
                return { element, status: "Memory Limit Exceeded" };
            }
            if (lowerText === "runtime error") {
                return { element, status: "Runtime Error" };
            }
            if (lowerText === "compile error") {
                return { element, status: "Compile Error" };
            }
        }
    }

    return null;
}

/**
 * Extracts the problem slug from the current URL.
 * Example: https://leetcode.com/problems/two-sum/ -> "two-sum"
 */
function extractProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : "";
}

/**
 * Extracts problem title from DOM or document title.
 */
function extractProblemTitle(slug) {
    if (document.title) {
        const cleanTitle = document.title
            .replace(/\s*-\s*LeetCode.*$/i, "")
            .replace(/^\d+\.\s*/, "")
            .trim();
        if (cleanTitle && cleanTitle.length > 0 && !cleanTitle.toLowerCase().includes("problem")) {
            return cleanTitle;
        }
    }

    const titleEl = document.querySelector("[data-cy='question-title']") ||
        document.querySelector("div[class*='text-title-']") ||
        document.querySelector("a[href*='/problems/'][class*='text-title']");
    if (titleEl && titleEl.textContent) {
        const text = titleEl.textContent.trim().replace(/^\d+\.\s*/, "");
        if (text) return text;
    }

    if (slug) {
        return slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
    }

    return "Unknown Problem";
}

/**
 * Extracts submission ID from URL or DOM.
 */
function extractSubmissionId() {
    // 1. From recently observed SPA navigation URL
    if (lastDetectedSubmissionId) {
        return { id: lastDetectedSubmissionId, source: "spa_url_transition" };
    }

    // 2. From current window pathname
    const urlMatch = window.location.pathname.match(/\/submissions\/(\d+)/);
    if (urlMatch && urlMatch[1]) {
        return { id: urlMatch[1], source: "location_pathname" };
    }

    // 3. From anchor tags in submission result panel
    const subLinks = document.querySelectorAll("a[href*='/submissions/']");
    for (const link of subLinks) {
        const href = link.getAttribute("href");
        if (href) {
            const match = href.match(/\/submissions\/(\d+)/);
            if (match && match[1]) {
                return { id: match[1], source: "dom_anchor_href" };
            }
        }
    }

    // 4. From elements with data-submission-id
    const dataEl = document.querySelector("[data-submission-id]");
    if (dataEl) {
        const id = dataEl.getAttribute("data-submission-id");
        if (id) return { id, source: "data_attribute" };
    }

    return null;
}

/**
 * Polls for submission ID to appear in URL or DOM if LeetCode delays updating it.
 */
async function waitForSubmissionId(maxWaitMs = 4000) {
    const existing = extractSubmissionId();
    if (existing) {
        console.log(`[LeetSync:Diagnostics] Submission ID detected immediately: ${existing.id} (source: ${existing.source})`);
        return existing.id;
    }

    console.log(`[LeetSync:Diagnostics] Submission ID not immediately in URL/DOM. Polling for up to ${maxWaitMs}ms...`);
    const interval = 250;
    let elapsed = 0;

    return new Promise((resolve) => {
        const timer = setInterval(() => {
            elapsed += interval;
            const res = extractSubmissionId();
            if (res) {
                clearInterval(timer);
                console.log(`[LeetSync:Diagnostics] Submission ID obtained after ${elapsed}ms: ${res.id} (source: ${res.source})`);
                resolve(res.id);
                return;
            }
            if (elapsed >= maxWaitMs) {
                clearInterval(timer);
                console.warn(`[LeetSync:Diagnostics] Submission ID polling timed out after ${maxWaitMs}ms.`);
                resolve(null);
            }
        }, interval);
    });
}

/**
 * Extracts the programming language used.
 */
function extractLanguage() {
    const KNOWN_LANGS = [
        "c++", "java", "python3", "python", "c", "c#",
        "javascript", "typescript", "php", "swift", "kotlin",
        "dart", "go", "golang", "ruby", "scala", "rust",
        "racket", "erlang", "elixir"
    ];

    // 1. Try known LeetCode language selectors
    const langBtn =
        document.querySelector("button[id*='headlessui-listbox-button']") ||
        document.querySelector("button[data-cy='lang-select']") ||
        document.querySelector("[data-e2e-locator='language-select']");

    if (langBtn && langBtn.textContent) {
        const text = langBtn.textContent.trim().toLowerCase();

        if (KNOWN_LANGS.includes(text)) {
            return normalizeLanguage(text);
        }
    }

    // 2. Current LeetCode UI: inspect all buttons
    for (const button of document.querySelectorAll("button")) {
        const text = button.textContent.trim().toLowerCase();

        if (KNOWN_LANGS.includes(text)) {
            console.log(
                `[LeetSync:Diagnostics] Language detected from button: ${text}`
            );

            return normalizeLanguage(text);
        }
    }

    // 3. Check common badge elements
    const detailTags = document.querySelectorAll(
        "div[class*='rounded'], span[class*='rounded'], div[class*='badge']"
    );

    for (const tag of detailTags) {
        const text = tag.textContent.trim().toLowerCase();

        if (KNOWN_LANGS.includes(text)) {
            console.log(
                `[LeetSync:Diagnostics] Language detected from badge: ${text}`
            );

            return normalizeLanguage(text);
        }
    }

    console.error("[LeetSync] Could not determine submission language.");
    return null;
}

/**
 * Normalizes language string to standardized identifier.
 */
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

/**
 * Requests raw code from Monaco editor via page-script in MAIN world.
 */
function requestMonacoCodeFromPage(timeoutMs = 1500) {
    return new Promise((resolve) => {
        const requestId = "req_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        let timer = null;

        function onResponse(event) {
            if (event.detail && event.detail.requestId === requestId) {
                window.removeEventListener("LEETSYNC_RESPONSE_PAGE_CODE", onResponse);
                if (timer) clearTimeout(timer);
                resolve(event.detail.code || null);
            }
        }

        window.addEventListener("LEETSYNC_RESPONSE_PAGE_CODE", onResponse);

        window.dispatchEvent(
            new CustomEvent("LEETSYNC_REQUEST_PAGE_CODE", {
                detail: { requestId: requestId }
            })
        );

        timer = setTimeout(() => {
            window.removeEventListener("LEETSYNC_RESPONSE_PAGE_CODE", onResponse);
            console.warn("[LeetSync:Diagnostics] Page-script Monaco request timed out. Proceeding to DOM fallback.");
            resolve(null);
        }, timeoutMs);
    });
}

/**
 * Fallback code extraction from DOM lines or pre/code elements.
 */
function extractCodeFromDom() {
    const viewLines = document.querySelectorAll(".monaco-editor .view-line");
    if (viewLines && viewLines.length > 0) {
        const lines = [];
        viewLines.forEach((line) => {
            lines.push(line.textContent || "");
        });
        const fullCode = lines.join("\n");
        if (fullCode.trim().length > 0) {
            console.log(`[LeetSync:Diagnostics] Extracted code from Monaco DOM view-lines (${lines.length} lines).`);
            return fullCode;
        }
    }

    const codeEl = document.querySelector("pre code, pre.code, .submission-detail-code, code");
    if (codeEl && codeEl.textContent && codeEl.textContent.trim().length > 0) {
        console.log(`[LeetSync:Diagnostics] Extracted code from submission details pre/code tag.`);
        return codeEl.textContent;
    }

    return "";
}

/**
 * Extracts raw submitted source code using page-script first, falling back to DOM.
 */
async function extractSourceCode() {
    try {
        const pageCode = await requestMonacoCodeFromPage();
        if (pageCode && pageCode.trim().length > 0) {
            return pageCode;
        }
    } catch (e) {
        console.warn("[LeetSync] Failed to retrieve code from page script:", e);
    }

    const domCode = extractCodeFromDom();
    if (domCode && domCode.trim().length > 0) {
        return domCode;
    }

    return "";
}

/**
 * Extracts all submission data when a submission is accepted.
 */
async function extractSubmissionData(detectedSubmissionId) {
    const problemSlug = extractProblemSlug();
    const problemTitle = extractProblemTitle(problemSlug);
    const language = extractLanguage();
    if (!language) {
        console.error("[LeetSync] Could not determine submission language. Aborting sync.");
        return null;
    }
    const code = await extractSourceCode();
    const submissionId =
        detectedSubmissionId ||
        (await waitForSubmissionId());

    if (!submissionId) {
        console.error("[LeetSync] Could not determine the real LeetCode submission ID. Aborting sync.");
        return null;
    }

    return {
        submissionId: String(submissionId),
        problemTitle: problemTitle,
        problemSlug: problemSlug,
        language: language,
        code: code
    };
}

/**
 * Checks chrome.storage.local to see if this submission ID has already been synced.
 */
async function isSubmissionAlreadySynced(submissionId) {
    if (!submissionId) return false;
    if (processedSubmissionIds.has(submissionId)) return true;

    try {
        const data = await chrome.storage.local.get("processedSubmissions");
        const processed = data.processedSubmissions || {};
        return Boolean(processed[submissionId]);
    } catch (e) {
        console.error("[LeetSync] Error checking storage for processed submissions:", e);
        return false;
    }
}

/**
 * Dispatches accepted submission data to the background service worker.
 */
async function handleAcceptedSubmission(detectedSubmissionId) {
    if (isProcessing) {
        console.log("[LeetSync] Already processing an accepted submission. Skipping duplicate call.");
        return;
    }

    isProcessing = true;

    try {
        console.log("[LeetSync:Diagnostics] Collecting submission data for accepted solution...");
        const submissionData = await extractSubmissionData(detectedSubmissionId);

        // Guard against duplicate processing
        if (await isSubmissionAlreadySynced(submissionData.submissionId)) {
            console.log(`[LeetSync:Diagnostics] Submission ${submissionData.submissionId} was already synced. Skipping.`);
            return;
        }

        processedSubmissionIds.add(submissionData.submissionId);

        const codePreview = submissionData.code ? submissionData.code.substring(0, 80).replace(/\n/g, " ") : "";
        console.log("[LeetSync:Diagnostics] Ready to send accepted submission to service worker:", {
            submissionId: submissionData.submissionId,
            problemTitle: submissionData.problemTitle,
            problemSlug: submissionData.problemSlug,
            language: submissionData.language,
            codeLength: submissionData.code ? submissionData.code.length : 0,
            codePreview: `"${codePreview}..."`
        });

        // Send to service worker
        chrome.runtime.sendMessage(
            {
                type: "LEETCODE_SUBMISSION_ACCEPTED",
                payload: submissionData
            },
            (response) => {
                if (response?.success) {
                    processedSubmissionIds.add(submissionData.submissionId);
                }
                if (chrome.runtime.lastError) {
                    console.error("[LeetSync] Error sending message to service worker:", chrome.runtime.lastError.message);
                } else {
                    console.log("[LeetSync:Diagnostics] Service worker sync response:", response);
                }
            }
        );
    } catch (error) {
        console.error("[LeetSync] Error handling accepted submission:", error);
    } finally {
        isProcessing = false;
        submissionState = "IDLE";
    }
}

/**
 * Disconnects the focused status observer and clears timeouts.
 */
function stopStatusObserver() {
    if (statusObserver) {
        statusObserver.disconnect();
        statusObserver = null;
    }
    if (statusObserverTimeout) {
        clearTimeout(statusObserverTimeout);
        statusObserverTimeout = null;
    }
}

/**
 * Attaches a focused MutationObserver to watch for submission progress and terminal state.
 * Pending -> Judging -> Accepted
 */
function startStatusObserver() {
    stopStatusObserver();

    console.log("[LeetSync] Starting status observer for new submission...");

    statusObserverTimeout = setTimeout(() => {
        console.log("[LeetSync] Status observation timed out (45s). Resetting to IDLE.");
        stopStatusObserver();
        submissionState = "IDLE";
    }, 45000);

    statusObserver = new MutationObserver(() => {
        const found = findSubmissionStatus();
        if (!found) return;

        const currentStatus = found.status;

        if (currentStatus === "Pending") {
            if (submissionState !== "PENDING") {
                console.log("[LeetSync:Status] Pending...");
                submissionState = "PENDING";
            }
        } else if (currentStatus === "Judging") {
            if (submissionState !== "JUDGING") {
                console.log("[LeetSync:Status] Judging...");
                submissionState = "JUDGING";
            }
        } else if (currentStatus === "Accepted") {
            // ONLY process if we were actively following a new submission in PENDING or JUDGING state!
            if (submissionState === "PENDING" || submissionState === "JUDGING") {
                console.log("[LeetSync:Status] Accepted! Transitioning state to ACCEPTED.");
                submissionState = "ACCEPTED";
                stopStatusObserver();
                const subId = extractSubmissionId();
                handleAcceptedSubmission(subId ? subId.id : null);
            }
        } else if (
            currentStatus === "Wrong Answer" ||
            currentStatus === "Time Limit Exceeded" ||
            currentStatus === "Memory Limit Exceeded" ||
            currentStatus === "Runtime Error" ||
            currentStatus === "Compile Error"
        ) {
            console.log(`[LeetSync:Status] Non-accepted terminal state: ${currentStatus}. Resetting to IDLE.`);
            stopStatusObserver();
            submissionState = "IDLE";
        }
    });

    statusObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

/**
 * Called when a new submission action is detected.
 */
function onSubmissionInitiated(triggerSource) {
    if (submissionState === "PENDING" || submissionState === "JUDGING") {
        console.log(`[LeetSync] Submission already in progress (${submissionState}). Ignoring repeat trigger from ${triggerSource}.`);
        return;
    }

    console.log(`[LeetSync] New submission initiated via ${triggerSource}. State -> PENDING.`);
    submissionState = "PENDING";
    startStatusObserver();
}

/**
 * Sets up global listeners to detect user submission intent.
 */
function setupSubmissionTriggers() {
    // 1. Delegated click listener on Submit button
    document.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            if (!target) return;

            const submitBtn = target.closest("button[data-e2e-locator='console-submit-button']") ||
                target.closest("button[data-cy='submit-code-btn']") ||
                target.closest("button");

            if (submitBtn) {
                const btnText = submitBtn.textContent ? submitBtn.textContent.trim().toLowerCase() : "";
                if (
                    submitBtn.getAttribute("data-e2e-locator") === "console-submit-button" ||
                    submitBtn.getAttribute("data-cy") === "submit-code-btn" ||
                    btnText === "submit"
                ) {
                    onSubmissionInitiated("click:submit_button");
                }
            }
        },
        true
    );

    // 2. Keyboard shortcut listener: Ctrl+Enter or Cmd+Enter
    document.addEventListener(
        "keydown",
        (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                onSubmissionInitiated("shortcut:ctrl_enter");
            }
        },
        true
    );

    // 3. Fallback: lightweight listener for Pending/Judging appearance if click was missed
    const triggerObserver = new MutationObserver(() => {
        if (submissionState === "IDLE") {
            const found = findSubmissionStatus();
            if (found && (found.status === "Pending" || found.status === "Judging")) {
                onSubmissionInitiated("dom:pending_status_appeared");
            }
        }
    });

    triggerObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Initialize
setupSubmissionTriggers();