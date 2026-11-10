# Finetune Lint

A dataset doctor for supervised and preference fine-tuning. Drop in the chat JSONL you are about to upload to a fine-tuning service and get a line-numbered report of everything that will fail the job or quietly hurt the model, then export a clean train/eval split.

Live: https://finetune-lint.vercel.app

## The pain

Fine-tuning jobs reject files after they have sat in a queue, LoRAs overfit on duplicated tickets, eval scores look great because eval rows were copied from train, and tuned models repeat customer emails and the same opening sentence. Most of that is visible in the data before you spend a training run on it.

## Features

- **Import**: JSONL, JSON arrays and CSV/TSV in OpenAI chat, ShareGPT, Alpaca and DPO (prompt/chosen/rejected, or OpenAI preference) shapes, detected per row. CSV column mapping. Validation report with line numbers before anything is committed.
- **Checks**: invalid JSON, unknown roles, empty turns, missing final assistant turn, system prompt placement, tool-call schema; token estimate (byte-level BPE approximation, about 3% from cl100k per turn on chat data) with truncation against your context length; exact and MinHash/LSH near duplicates; train/eval leakage; PII (emails, phones, Luhn-checked cards, SSNs, API keys); refusals and boilerplate openers; language detection by character trigrams; class balance; DPO pair checks (identical pairs, length bias); cost and time for your price, epochs and throughput.
- **Actions**: fix-ups with a before/after preview (normalise roles, strip PII with placeholders, fit the context, dedupe, drop leaks and broken rows), a stratified split that keeps duplicate clusters on one side, export to OpenAI/ShareGPT/Alpaca/TRL JSONL, issues CSV, and a printable data card.
- **History**: every import, fix-up and split is a version; compare any two, restore, or export an old one.
- **Workspace**: multiple datasets stored locally in IndexedDB. Optional email/password account syncs settings, versions and small datasets across devices.
- **Samples** (synthetic, labelled): a 1,200-row support-bot SFT set plus 120 eval rows with planted duplicates, leaks, PII, refusals and broken lines, and a 160-pair DPO set with a length bias.

Everything runs in the browser; files are never uploaded for linting.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests (node --test)
npm run build
```

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` (see `.env.example`); without them the app runs local-only.

Built by Aryan Kansagara. Independent project, not affiliated with Fireworks AI.
