# Cloudflare deployment receipts

Production deployment receipts are authoritative as **GitHub Actions artifacts scoped to one workflow run and attempt**.

The deployment workflow must not commit, push, merge, or rebase `main` merely to persist a receipt. This keeps observability metadata from racing with source changes or turning a successful Cloudflare deployment into a false-red workflow.

The tracked `taistock-mcp-cloudflare.json` file is legacy historical state only. New deployment truth is determined by the workflow's OAuth KV, Worker deploy, Cron verification, and live smoke gates; the corresponding per-run receipt is uploaded as an Actions artifact.
