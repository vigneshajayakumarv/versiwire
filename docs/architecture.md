# Versiwire — Automated Tech News to Instagram Pipeline

## Overview

Versiwire is a fully automated content pipeline that discovers the day's most significant technology innovation, verifies its legitimacy, generates a branded news card, routes it through human approval, and publishes it to Instagram — all without manual intervention beyond a single approval tap.

It runs unattended on a self-hosted n8n instance on a Mumbai VPS, reachable at `https://n8n.versigear.com` via a Cloudflare named tunnel (zero open inbound ports). Versiwire operates as a branded property of the Versigear tech-accessories brand, publishing to the Instagram account @theversiwire.

**Stack:** n8n (orchestration) · Claude API (analysis) · browserless/Chromium (image rendering) · imgbb (image hosting) · Meta Graph API (Instagram publishing) · Gmail (approval) · Cloudflare Tunnel (public access) · Docker on a hardened Ubuntu VPS.

---

## End-to-end flow

The workflow executes as a single linear pipeline with two conditional gates and a human-in-the-loop approval step.

### 1. Daily trigger
A Schedule Trigger fires once per day at 09:00 (Asia/Dubai). This is the only automatic entry point; the workflow otherwise runs on manual execution during testing.

### 2. News ingestion (3× RSS + Merge)
Three RSS Read nodes pull the latest articles from TechCrunch, The Verge, and Ars Technica in parallel. A Merge node (append mode) combines all three feeds into a single item stream — typically ~50 articles across the three sources.

### 3. Filter & prompt construction (Code node)
A JavaScript Code node performs two jobs:
- **Filters** the merged articles down to only those published in the last 24 hours, stripping HTML from snippets and tagging each with its source outlet.
- **Builds the Claude prompt** dynamically, embedding the filtered story list as JSON and appending the analysis instructions. If no fresh stories exist, it flags the run as empty so downstream nodes can short-circuit.

### 4. Empty-check gate (IF)
A "Has Stories?" IF node routes the run onward only if fresh stories were found. On an empty day, the branch terminates silently.

### 5. AI analysis (Claude API via HTTP Request)
An HTTP Request node calls the Anthropic Messages API (`claude-sonnet-4-6`) with the constructed prompt. Claude is instructed to:
- **Select** the single most significant tech *innovation* of the day (new product, breakthrough, or launch — explicitly excluding opinion pieces, layoffs, and lawsuits).
- **Legitimacy-score** it 1–10, scoring 8+ only when the story appears in two or more sources or is a confirmed official announcement, flagging anything that reads as rumor or leak.
- **Write** an Instagram caption (hook line, plain-language summary, source credit, hashtags) and assign a one-to-two-word **category** (e.g. AI, HARDWARE, SECURITY).

Claude returns strict JSON with fields: `category`, `headline`, `summary`, `sources`, `source_link`, `legit_score`, `legit_reason`, `ig_caption`.

### 6. Response parsing (Code node)
A Code node strips any markdown fences and parses Claude's raw text into structured JSON, throwing a clear error if the model returns malformed output.

### 7. Legitimacy gate (IF)
A "Legit Score >= 8?" IF node passes only high-confidence, well-sourced stories. Anything scoring below 8 is dropped, so weak or unverified news never reaches publication.

### 8. Human approval (Gmail — Send and Wait)
A Gmail "Send and Wait for Response" node emails the operator a preview: headline, legitimacy score and reasoning, sources, and the full caption, with **Approve** and **Decline** buttons. The workflow pauses here until the operator responds. Because n8n is exposed via the Cloudflare tunnel, the approval buttons resolve from anywhere — including mobile — without an SSH tunnel.

### 9. Approval gate (IF)
An "Approved?" IF node reads the approval response. Only an explicit approval continues to publication; a decline ends the run.

### 10. Branded card generation (Set → browserless → imgbb)
This three-node sub-sequence turns the approved story into a public image URL:

- **Build Card HTML (Set node):** Injects the story's category, headline, source, and current date into a self-contained HTML template. The template is a 1080×1080 "wire dispatch" design — deep signal-black background, teal signal accent, Space Grotesk headline, Space Mono metadata, a live pulse dot, category dateline, source credit, and a "VERIFIED" stamp — rendered with Google Fonts. Story fields are pulled by node reference (`$('Parse Claude Response')`) so they survive the intervening Gmail node, which would otherwise overwrite the item data.
- **HTTP To Binary (browserless):** POSTs the HTML to a self-hosted `browserless/chromium` Docker container's `/screenshot` endpoint (`http://browserless:3000`, reached over the shared `versiwire-net` Docker network), returning a rendered 1080×1080 image as binary.
- **Upload to imgbb:** POSTs the rendered image to the imgbb API, which returns a permanent, public direct URL that Meta's servers can fetch.

### 11. Instagram publishing (Create container → Wait → Publish)
The final three nodes post to Instagram via the Meta Graph API (v22):

- **IG - Create Media Container:** POSTs to `/{ig-user-id}/media` with the imgbb image URL and Claude's caption, authenticated via a Query Auth credential holding a non-expiring Page access token. Returns a media container ID.
- **Wait 30s:** Pauses to let Meta finish processing the container.
- **IG - Publish Post:** POSTs to `/{ig-user-id}/media_publish` with the container ID, publishing the card and caption live to @theversiwire.

---

## Architecture and infrastructure notes

**Hosting.** Everything runs in Docker on a hardened Ubuntu VPS (default-deny firewall, SSH key-only, root login disabled). Three containers share a Docker network (`versiwire-net`): n8n, browserless/chromium, and cloudflared. This shared network is why nodes address services by container name (`browserless:3000`, `n8n:5678`) rather than localhost.

**Public access without open ports.** A Cloudflare named tunnel connects outbound from the `cloudflared` container to Cloudflare's edge, mapping `n8n.versigear.com` → `n8n:5678`. This gives n8n a stable public HTTPS URL — required so the Gmail approval webhook links work from any device — without exposing the VPS IP or opening any inbound firewall ports. n8n is configured with `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` set to the tunnel hostname so it generates correct approval links.

**Why an image host is needed.** Instagram's `/media` endpoint does not accept uploaded image binaries — it requires a publicly fetchable image URL. Since n8n is not itself publicly serving files, the rendered card is uploaded to imgbb to obtain that public URL.

**Credential handling.** Secrets (Instagram Page token, Anthropic API key, imgbb key, Gmail OAuth) are stored as n8n credentials, not hardcoded into node bodies, so the workflow JSON can be exported without leaking them. The Instagram token is a non-expiring Page access token derived from a long-lived user token, so the pipeline does not silently break on token expiry.

**Design intent.** The card design leans into the brand name (Versiwire = newswire): a teletype/wire-service aesthetic with monospace metadata and a signal motif, tying the automated news property visually back to the Versigear parent brand.

---

## Editorial and compliance safeguards

- **Two quality gates** (freshness + legitimacy score ≥ 8) ensure only recent, well-sourced innovations proceed.
- **Human approval** before every post keeps a person in control of what publishes under the brand.
- **Original captions and imagery** — Claude writes original summaries and the card uses an owned template, avoiding reproduction of source article text or images; sources are credited on-card and in-caption.
- **Legitimacy reasoning** is surfaced in the approval email so the operator can judge each story's sourcing before approving.

---

## Operating the pipeline

- **Activate:** Publish the workflow in n8n so the daily 09:00 schedule fires.
- **Daily run:** At 09:00 the pipeline runs autonomously up to the approval email; the operator taps Approve (from any device) and the post publishes automatically.
- **Timezone:** Workflow timezone is set to Asia/Dubai so the 09:00 trigger fires at the intended local hour.
- **Security follow-up:** The n8n UI is reachable at the tunnel hostname; a Cloudflare Access policy (email + one-time PIN) should gate the editor while leaving the webhook paths open for approvals.
