# Versiwire — Autonomous AI Content Pipeline with Human-in-the-Loop Governance

An event-driven pipeline that autonomously discovers the day's most significant technology story, verifies its legitimacy with an LLM, generates a branded graphic, and publishes to Instagram — but only after a human approves. Built to explore the parts of production AI systems that actually matter: **hallucination control, human-in-the-loop governance, idempotency, and zero-trust operations** — not just calling an API.

> **Status:** Live in production, running unattended on a self-hosted VPS. Publishes to [@theversiwire](https://instagram.com/theversiwire).

---

## Why this exists

Deploying an LLM is easy. Deploying one that acts autonomously, at a schedule, publishing to the public internet — without doing something wrong — is the hard part. Versiwire is a working study of the guardrails that make that safe:

- **What stops the AI from publishing garbage?** → multi-source legitimacy scoring with a hard threshold
- **What keeps a human in control?** → an approval gate that blocks publishing and auto-stops if ignored
- **What stops it repeating itself across runs?** → persistent deduplication (idempotency)
- **How are secrets and network exposure handled?** → credentials store, zero open inbound ports

The Instagram account is just the visible output. The engineering is in the governance.

---

## Architecture

```
Schedule (2×/day)
     │
     ▼
3× RSS sources ──► Merge ──► Filter + Dedup ──► [no new stories? stop]
                                   │
                                   ▼
                        LLM analysis (Claude)
                   pick top story · legitimacy score ·
                     category · caption generation
                                   │
                                   ▼
                     Legitimacy gate (score ≥ 8?) ──► [fail? stop]
                                   │
                                   ▼
                   Human approval (email, 30-min timeout)
                        approve ─┬─ decline/timeout ──► stop
                                 ▼
                    Render branded card (headless Chromium)
                                 │
                                 ▼
                       Upload → public image URL
                                 │
                                 ▼
                    Publish to Instagram (Graph API)
                                 │
                                 ▼
                    Record posted story (dedup memory)
```

**Stack:** n8n (orchestration) · Anthropic Claude API (analysis) · browserless/Chromium (image rendering) · Meta Graph API (publishing) · Gmail (approval) · Docker · Cloudflare Tunnel · Ubuntu VPS.

---

## Engineering decisions

### Hallucination / quality control
The LLM doesn't just summarize — it's constrained to **select** from a fixed candidate list and **score legitimacy 1–10**, only clearing stories that appear in multiple independent sources or are confirmed official announcements. Anything below the threshold is dropped before it can reach publication. The model's legitimacy reasoning is surfaced to the human approver for a second judgment.

### Human-in-the-loop governance
Nothing publishes autonomously. An approval step pauses the pipeline and emails a preview with Approve/Decline actions. Critically, on **timeout (30 min) the pipeline fails closed** — it stops rather than publishing unreviewed content. Stale or unwanted stories never slip through by default.

### Idempotency
The same story surfaces across multiple runs and multiple outlets. A persistent store records published headlines and the pipeline filters them out on subsequent runs — and feeds recently-posted headlines back into the LLM prompt so it won't pick the same news re-reported by a different source. Reruns never duplicate output.

### Secrets management
No credentials are hardcoded in the workflow. All secrets (LLM key, publishing token, image-host key, email OAuth) live in the platform's credential store and are referenced by the nodes, so the exported workflow JSON in this repo is safe to publish.

### Zero-trust networking
All services are localhost-bound. Public reachability (required so approval links work from any device) is provided by an **outbound-only Cloudflare tunnel** — no inbound firewall ports are opened, and the host's IP is never exposed.

### Non-expiring publishing token
Instagram publishing uses a Page access token derived from a long-lived user token, so the pipeline doesn't silently break on token expiry — a common failure mode for scheduled integrations.

---

## Repository contents

```
├── README.md                        # this file
├── workflow/
│   └── versiwire.workflow.json       # sanitized n8n workflow (no secrets)
├── code/
│   ├── filter-and-build-prompt.js    # dedup + LLM prompt construction
│   └── record-posted.js              # persistence for idempotency
├── templates/
│   └── card-template.html            # branded 1080×1080 card (token placeholders)
├── docs/
│   ├── architecture.md               # detailed pipeline walkthrough
│   └── screenshots/                  # card, approval email, published post
└── .gitignore
```

> The workflow JSON is exported with all credentials removed. To run it, you supply your own credentials in n8n and your own API keys.

---

## Key implementation notes

- **Image hosting is required, not optional.** The Instagram publishing endpoint accepts a public image URL, not a file upload — so the rendered card is hosted to obtain a fetchable URL before publishing.
- **Static/persistent data only survives scheduled runs**, not manual test executions — a platform quirk worth knowing when testing dedup behavior.
- **Container networking:** services address each other by container name over a shared Docker network rather than `localhost`, since each runs in its own container.

---

## What I'd build next

- Replace the LLM's generic "most significant" heuristic with a small ranking model tuned on engagement signals
- Add observability (run metrics, rejection-rate dashboard) to quantify how often the legitimacy gate actually filters
- Self-host image rendering + hosting on-domain to remove the third-party image host dependency

---

## Related work

Part of a pair of AI systems exploring both sides of enterprise AI deployment:

- **[Northwind IT Service Desk Agent](#)** — internal-ops AI agent: LangGraph, Claude, SQLite-backed HITL checkpointing, policy RAG, Streamlit dashboard (90% classification accuracy, 100% routing safety).
- **Versiwire** (this repo) — external-content pipeline: autonomous curation, LLM verification, human-in-the-loop publishing, live in production.

---

*Built as an engineering study of production AI governance. The interesting part isn't the automation — it's the guardrails.*
