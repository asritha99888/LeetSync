# LeetSync ⚡

> Automatically sync accepted LeetCode submissions to a GitHub repository in real time.

LeetSync is a Manifest V3 Chrome extension designed to seamlessly detect accepted LeetCode submissions and push clean, well-formatted solution files directly to your chosen GitHub repository.

Built to handle LeetCode's dynamic Single Page Application (SPA) architecture, LeetSync combines DOM mutation observers, a dedicated Monaco Editor bridge in the main page context, robust duplicate prevention, and GitHub REST API integration with SHA-based versioning.

---

## 🚀 Features

- 🔐 **GitHub OAuth 2.0 & PAT Support**: Authenticate securely using `chrome.identity` with OAuth 2.0 PKCE, or use a Personal Access Token (PAT) for direct local setups.
- 🛡️ **Secure Token Storage**: Safely persists authentication tokens and repository configuration in `chrome.storage.local`.
- 🎯 **Reliable Submission Detection**: Tracks the entire submission lifecycle (`IDLE` &rarr; `PENDING` &rarr; `JUDGING` &rarr; `ACCEPTED`) using `MutationObserver`, preventing false triggers from static page elements or acceptance rates.
- ⚡ **SPA Navigation Awareness**: Monitors URL changes and extracts submission IDs from dynamic route transitions.
- 💻 **Monaco Editor Bridge**: Injects a main-world page script to reliably extract user source code directly from active Monaco Editor instances and memory models.
- 📁 **Deterministic Path Structure**: Stores solutions cleanly under `solutions/<problem-slug>.<ext>` based on normalized language identifiers.
- 🚫 **Duplicate Commit Prevention**: Verifies submission IDs and compares file content against existing repository files before committing.
- 🔍 **SHA-Aware Updates**: Fetches the existing file's Git blob SHA to perform conflict-free file updates when solutions are improved or resubmitted.
- ⚠️ **Graceful Error Handling**: Detects expired tokens (HTTP 401), invalid repository settings, and API rate limits, alerting users via the extension popup.
- 📊 **Modern Glassmorphic Popup**: Check connection status, configure target repositories, test access, and view direct links to the latest synchronized solution.
- 🧪 **Comprehensive Automated Test Suite**: Built-in test coverage using Node.js native test runner verifying all 8 core test scenarios.

---

## 🏗️ Architecture

```text
  ┌─────────────────────────────────────────────────────────────┐
  │                          LeetCode                           │
  │                     (SPA / Dynamic DOM)                     │
  │                      Submit Solution                        │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │              Content Script (content.js)                    │
  │                                                             │
  │  • MutationObserver monitors submission status              │
  │  • Lifecycle State Machine: IDLE → PENDING → ACCEPTED       │
  │  • Extracts problem title, slug, and language               │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                      Custom DOM Event Dispatch
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │          Monaco Bridge (content/page-script.js)             │
  │                   (MAIN execution world)                    │
  │                                                             │
  │  • Reads active Monaco Editor instance                      │
  │  • Filters internal schema/definition models                │
  │  • Extracts clean solution source code                      │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                       Chrome Runtime Message
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │         Service Worker (background/service-worker.js)       │
  │                      (Manifest V3)                          │
  │                                                             │
  │  • Authenticates and verifies target repo                   │
  │  • Duplicate check via storage & file content comparison    │
  │  • Safe base64 UTF-8 encoding                               │
  │  • Fetches existing file SHA (if updating)                  │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                         GitHub REST API
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                 GitHub Repository (Remote)                  │
  │                                                             │
  │  PUT /repos/{owner}/{repo}/contents/solutions/{slug}.{ext}  │
  └─────────────────────────────────────────────────────────────┘
```

---

## 🔍 How It Works

### 1. Submission Lifecycle State Machine
Rather than simply searching for the keyword `"Accepted"` on the webpage (which can be triggered by historical stats or page text), LeetSync tracks the active submission lifecycle:
```text
[IDLE] ──► [PENDING / JUDGING] ──► [ACCEPTED] ──► [SYNC TO GITHUB]
```
- A `MutationObserver` listens for status badges appearing on the page.
- Reloading an already accepted submission or navigating back will **not** trigger redundant synchronization.
- Submissions resulting in "Wrong Answer", "Time Limit Exceeded", or "Runtime Error" reset the state machine cleanly without triggering sync.

### 2. Monaco Editor Code Extraction Bridge
LeetCode isolates its editor environment. Standard content scripts run in an isolated execution world and cannot access `window.monaco`. 

LeetSync solves this cleanly via Manifest V3's `"world": "MAIN"` content script registration:
1. `content/page-script.js` runs in the main world context with direct access to `window.monaco.editor`.
2. When an accepted solution is verified, `content.js` dispatches a custom event `LEETSYNC_REQUEST_PAGE_CODE`.
3. `page-script.js` queries active editor instances and model buffers (filtering out internal TypeScript definition files).
4. The extracted source code is dispatched back via `LEETSYNC_RESPONSE_PAGE_CODE`.

### 3. Smart Duplicate Prevention & Version Control
When syncing a solution:
1. **Submission ID Tracking**: Each unique LeetCode submission ID is remembered in `chrome.storage.local`.
2. **Content Verification**: The service worker fetches any existing file at `solutions/<slug>.<ext>`.
3. **Identical Code Guard**: If the file exists and its content matches the submission exactly, the commit is skipped to keep your Git history clean.
4. **SHA-Preserving Updates**: If the code is new or modified, the existing commit blob SHA is included in the GitHub REST API `PUT` request to update the file without collisions.

---

## 📁 Repository Structure

```text
LeetSync/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background/
│   └── service-worker.js      # Background worker handling GitHub API, auth & sync
├── content/
│   ├── content.js             # Content script observing DOM, SPA transitions & lifecycle
│   └── page-script.js         # Main-world script extracting Monaco Editor source code
├── popup/
│   ├── popup.html             # Extension dashboard UI
│   ├── popup.css              # Glassmorphic dark styling
│   └── popup.js               # UI controller for auth, repo selection, and status
├── oauth-server/
│   ├── server.js              # Lightweight Express backend for GitHub OAuth token exchange
│   └── package.json
├── solutions/                 # Default directory structure for synchronized solutions
│   ├── add-two-numbers.cpp
│   ├── longest-common-prefix.cpp
│   └── reverse-integer.cpp
├── test/
│   ├── sync.test.mjs          # Core sync, SHA handling, and duplicate detection tests
│   └── dom_and_popup.test.mjs # Manifest and popup DOM verification tests
└── README.md
```

---

## 🛠️ Getting Started

### Prerequisites
- Google Chrome (or any Chromium-based browser like Brave, Edge, or Opera)
- A GitHub account and a repository to store your solutions (e.g., `leetcode-solutions`)
- [Node.js](https://nodejs.org/) (v18+) for running tests or the companion OAuth server

---

### Step 1: Install the Extension in Chrome

1. Clone this repository:
   ```bash
   git clone https://github.com/asritha99888/LeetSync.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** in the top left corner.
5. Select the `LeetSync` root folder containing `manifest.json`.
6. LeetSync is now loaded and visible in your Chrome toolbar!

---

### Step 2: Configure Authentication

You can authenticate using either **Personal Access Token (PAT)** or **OAuth 2.0**:

#### Option A: Personal Access Token (Fastest Setup)
1. Go to [GitHub Settings &rarr; Personal access tokens (classic)](https://github.com/settings/tokens).
2. Generate a new token with the `repo` scope.
3. Click the LeetSync icon in Chrome to open the popup.
4. Expand **Use Personal Access Token (PAT)**.
5. Paste your token and click **Connect with Token**.

#### Option B: GitHub OAuth 2.0 App
1. Register a new OAuth App under [GitHub Developer Settings](https://github.com/settings/developers).
2. Set the Authorization Callback URL to the Chrome extension redirect URL shown in the LeetSync popup (e.g., `https://<extension-id>.chromiumapp.org/`).
3. Set up the OAuth token exchange server in `oauth-server/`:
   ```bash
   cd oauth-server
   npm install
   export GITHUB_CLIENT_ID="your_client_id"
   export GITHUB_CLIENT_SECRET="your_client_secret"
   npm start
   ```
4. Enter your OAuth Client ID into the LeetSync popup and click **Authenticate via OAuth 2.0**.

---

### Step 3: Configure Target Repository

1. In the LeetSync popup under **Target Repository**:
   - **Owner / Org**: Your GitHub username or organization (e.g., `asritha99888`)
   - **Repository**: Your repository name (e.g., `LeetSync` or `leetcode-solutions`)
2. Click **Save Config**.
3. Click **Test Access** to verify write permissions.

---

### Step 4: Solve & Sync!

1. Go to any problem on [leetcode.com](https://leetcode.com/problems/two-sum/).
2. Write and submit your solution.
3. When LeetCode displays **Accepted**, LeetSync automatically:
   - Captures the problem name and language
   - Extracts your solution code from the Monaco editor
   - Commits and pushes the solution to `solutions/<problem-name>.<ext>` on GitHub
4. Open the LeetSync popup to view the sync confirmation and a direct link to the new file on GitHub.

---

## 🌐 Supported Languages

LeetSync automatically maps LeetCode languages to standard file extensions:

| Language | Extension | Path Example |
| :--- | :--- | :--- |
| **C++ / C** | `.cpp` / `.c` | `solutions/two-sum.cpp` |
| **Java** | `.java` | `solutions/two-sum.java` |
| **Python / Python3** | `.py` | `solutions/two-sum.py` |
| **JavaScript** | `.js` | `solutions/two-sum.js` |
| **TypeScript** | `.ts` | `solutions/two-sum.ts` |
| **Go** | `.go` | `solutions/two-sum.go` |
| **Rust** | `.rs` | `solutions/two-sum.rs` |
| **C#** | `.cs` | `solutions/two-sum.cs` |
| **Kotlin** | `.kt` | `solutions/two-sum.kt` |
| **Swift** | `.swift` | `solutions/two-sum.swift` |
| **Ruby / PHP / Dart / SQL** | `.rb` / `.php` / `.dart` / `.sql` | `solutions/two-sum.<ext>` |

---

## 🧪 Testing

LeetSync includes an automated test suite executed with Node's native test runner (`node:test`):

```bash
node --test test/*.test.mjs
```

### Test Suite Coverage
- **TEST 1 & 7**: Fresh accepted submission creates a new GitHub file.
- **TEST 2**: Submitting identical solution skips redundant commits.
- **TEST 3 & 8**: Updated solution for an existing problem updates file using GitHub SHA.
- **TEST 4**: Page reload on an already accepted submission does not re-sync.
- **TEST 5**: Rapid DOM mutations during judging produce a single sync event.
- **TEST 6**: HTTP 401 Unauthorized clears token and sets `authRequired`.
- **UTF-8 Encoding**: Multi-byte characters and comments encoded safely without loss.
- **Manifest V3 & DOM**: Validates manifest permissions and popup element bindings.

---

## 📄 License

This project is licensed under the MIT License.

---

<div align="center">
  <sub>LeetSync v1.0 • GDG × Iris 2026</sub>
</div>
