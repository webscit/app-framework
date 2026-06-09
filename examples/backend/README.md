# Backend Example

Demo backend app built on `framework-core`. Runs a sine-wave producer, a log producer, and mounts the AI layout generation endpoint (`POST /ai/layout`).

## Quick start

```bash
# 1. Copy the example env file and fill in your API key
cp examples/backend/.env.example .env

# 2. Start the backend
uv run uvicorn examples.backend.main:app --reload
```

The frontend dev server proxies `/ai/*` to this backend, so `npm run dev` works without any extra config once the key is set.

## Environment Variables

Copy `.env.example` to `.env` at the repo root and edit as needed.

| Variable                   | Required | Default                       | Description                                                                                                                                                                       |
| -------------------------- | -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`       | **Yes**  | —                             | OpenRouter API key. Get one at [openrouter.ai](https://openrouter.ai).                                                                                                            |
| `OPENROUTER_DEFAULT_MODEL` | No  | `anthropic/claude-sonnet-4.6` | Model identifier. See `.env.example` for alternatives (`anthropic/claude-haiku-4.5-20251001` for faster/cheaper, `meta-llama/llama-3.3-70b-instruct:free` for zero-cost testing). |
| `OPENROUTER_MAX_TOKENS`    | No       | `2048`                        | Hard cap on tokens per AI response. Increase if the model truncates large layouts.                                                                                                |
| `OPENROUTER_TEMPERATURE`   | No       | `0.2`                         | Sampling temperature. Keep low (0.0–0.3) for deterministic JSON output.                                                                                                           |

## Obtaining an API key

Sign up at [openrouter.ai](https://openrouter.ai), go to **Keys**, and create a new key. Model names evolve quickly — see `.env.example` for recommended options, or browse [openrouter.ai/models](https://openrouter.ai/models) for the full current list.
