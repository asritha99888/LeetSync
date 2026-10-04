import express from "express";

const app = express();

app.use(express.json());

// Allow requests from the Chrome extension.
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && origin.startsWith("chrome-extension://")) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

const PORT = process.env.PORT || 3000;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    throw new Error(
        "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured."
    );
}

app.post("/oauth/github/exchange", async (req, res) => {
    try {
        const {
            clientId,
            code,
            redirectUri,
            codeVerifier
        } = req.body || {};

        // Validate required parameters.
        if (
            !clientId ||
            !code ||
            !redirectUri ||
            !codeVerifier
        ) {
            return res.status(400).json({
                error: "Missing required OAuth parameters."
            });
        }

        // Make sure the request is for our GitHub OAuth application.
        if (clientId !== GITHUB_CLIENT_ID) {
            return res.status(400).json({
                error: "Invalid client ID."
            });
        }

        // Exchange the authorization code with GitHub.
        const response = await fetch(
            "https://github.com/login/oauth/access_token",
            {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    client_id: GITHUB_CLIENT_ID,
                    client_secret: GITHUB_CLIENT_SECRET,
                    code,
                    redirect_uri: redirectUri,
                    code_verifier: codeVerifier
                })
            }
        );

        const data = await response.json();

        console.log("GitHub token exchange result:", {
            status: response.status,
            error: data.error,
            error_description: data.error_description
        });

        // GitHub returned an error.
        if (!response.ok || data.error) {
            return res.status(response.status || 400).json({
                error:
                    data.error_description ||
                    data.error ||
                    "GitHub token exchange failed."
            });
        }

        // Make sure GitHub actually returned a token.
        if (!data.access_token) {
            return res.status(500).json({
                error: "GitHub did not return an access token."
            });
        }

        // Send only the necessary token information back
        // to the extension.
        return res.json({
            access_token: data.access_token,
            token_type: data.token_type,
            scope: data.scope
        });

    } catch (error) {
        console.error("OAuth exchange failed:", error);

        return res.status(500).json({
            error: error.message || "OAuth exchange failed."
        });
    }
});

app.listen(PORT, () => {
    console.log(
        `LeetSync OAuth server listening on port ${PORT}`
    );
});