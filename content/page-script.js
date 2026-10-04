// LeetSync page-script.js (runs in MAIN execution world)
// Safely reads the active Monaco Editor instance and models in the page's execution context.

(function () {
    console.log("[LeetSync:PageScript] Initialized in MAIN execution world.");

    /**
     * Identifies the exact user solution from Monaco Editor.
     * Strategy 1: Active Monaco Editor instances attached to the DOM.
     * Strategy 2: Filtered Monaco models (excluding internal TypeScript/schema declarations).
     */
    function getMonacoSourceCode() {
        try {
            if (!window.monaco || !window.monaco.editor) {
                console.warn("[LeetSync:PageScript] window.monaco.editor is not defined on this page.");
                return null;
            }

            // Strategy 1: Active editor instances in the DOM
            if (typeof window.monaco.editor.getEditors === "function") {
                const editors = window.monaco.editor.getEditors();
                if (editors && editors.length > 0) {
                    console.log(`[LeetSync:PageScript] Found ${editors.length} Monaco editor instance(s).`);

                    for (let i = 0; i < editors.length; i++) {
                        const ed = editors[i];
                        const domNode = ed.getDomNode ? ed.getDomNode() : null;
                        const isAttached = domNode ? document.body.contains(domNode) : false;
                        const model = ed.getModel ? ed.getModel() : null;

                        if (model && !model.isDisposed()) {
                            const code = ed.getValue ? ed.getValue() : model.getValue();
                            const langId = model.getLanguageId ? model.getLanguageId() : "unknown";
                            const lineCount = model.getLineCount ? model.getLineCount() : 0;
                            const uri = model.uri ? model.uri.toString() : "unknown";

                            console.log(`[LeetSync:PageScript] Editor #${i} details: attached=${isAttached}, lang=${langId}, lines=${lineCount}, uri=${uri}`);

                            if (code && typeof code === "string" && code.trim().length > 0) {
                                console.log(`[LeetSync:PageScript] Successfully identified code from Monaco Editor #${i} (${code.length} chars, ${lineCount} lines).`);
                                return code;
                            }
                        }
                    }
                }
            }

            // Strategy 2: Iterate over all Monaco models, filtering out internal declaration/schema files
            if (typeof window.monaco.editor.getModels === "function") {
                const models = window.monaco.editor.getModels();
                console.log(`[LeetSync:PageScript] Evaluating ${models.length} Monaco model(s)...`);

                const candidates = [];

                for (let i = 0; i < models.length; i++) {
                    const model = models[i];
                    if (!model || model.isDisposed()) continue;

                    const uri = model.uri ? model.uri.toString() : "";
                    const langId = model.getLanguageId ? model.getLanguageId() : "";

                    // Filter out internal Monaco libraries (e.g. TypeScript lib declarations, JSON schemas)
                    if (
                        uri.includes("typescript/lib.") ||
                        uri.includes("schemas") ||
                        uri.includes("schema.json") ||
                        uri.includes("vscode")
                    ) {
                        continue;
                    }

                    const val = model.getValue();
                    if (val && typeof val === "string" && val.trim().length > 0) {
                        const lines = model.getLineCount ? model.getLineCount() : val.split("\n").length;
                        candidates.push({
                            index: i,
                            uri: uri,
                            langId: langId,
                            lines: lines,
                            length: val.length,
                            code: val
                        });
                        console.log(`[LeetSync:PageScript] Model #${i} candidate: lang=${langId}, lines=${lines}, uri=${uri}`);
                    }
                }

                if (candidates.length > 0) {
                    // Pick the candidate with the highest content length / lines
                    candidates.sort((a, b) => b.length - a.length);
                    const best = candidates[0];
                    console.log(`[LeetSync:PageScript] Selected best candidate model #${best.index} (${best.langId}, ${best.lines} lines, ${best.length} chars).`);
                    return best.code;
                }
            }
        } catch (e) {
            console.error("[LeetSync:PageScript] Error reading Monaco editor:", e);
        }
        return null;
    }

    // Listen for code extraction requests dispatched from content.js
    window.addEventListener("LEETSYNC_REQUEST_PAGE_CODE", function (event) {
        const requestId = event.detail ? event.detail.requestId : null;
        console.log(`[LeetSync:PageScript] Received code extraction request (ID: ${requestId}).`);

        const code = getMonacoSourceCode();

        if (code) {
            const preview = code.substring(0, 60).replace(/\n/g, " ");
            console.log(`[LeetSync:PageScript] Code extracted successfully: "${preview}..." (${code.length} chars).`);
        } else {
            console.warn("[LeetSync:PageScript] No code extracted from Monaco.");
        }

        window.dispatchEvent(
            new CustomEvent("LEETSYNC_RESPONSE_PAGE_CODE", {
                detail: {
                    requestId: requestId,
                    code: code
                }
            })
        );
    });
})();
