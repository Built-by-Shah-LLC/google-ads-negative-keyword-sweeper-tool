# OpenAI model evaluation

Evaluation date: `2026-08-31`

Rule set: `2026-08-31.2`

The production prompt and strict validation contract were run over all 124 labeled
handoff examples. Estimated cost uses standard token prices documented by OpenAI on the
evaluation date. This re-evaluation includes the client-requested own-brand negative rule.

| Model | Agreement | KEEP accuracy | Negative recall | Negative precision | False positives | Estimated run cost |
|---|---:|---:|---:|---:|---:|---:|
| `gpt-5-nano` (10-term batches) | 67.74% | 96.15% | 47.22% | 94.44% | 2 | $0.011758 |
| `gpt-4o-mini` | 68.55% | 98.08% | 47.22% | 97.14% | 1 | $0.007624 |
| `gpt-5.6-luna` | 91.94% | 96.15% | 88.89% | 96.97% | 2 | $0.013197 |

## Selection

Use `gpt-5.6-luna` with low reasoning effort. `gpt-4.1-nano` and `gpt-5-nano` at the
production 50-term batch size failed the strict rule/decision contract even after the
validation retry. Reducing `gpt-5-nano` to 10-term batches made its output structurally
valid, but it and `gpt-4o-mini` each missed 38 of 72 expected negatives. Luna missed 8.
The full-set measured difference between Luna and `gpt-4o-mini` was $0.005573 while Luna
improved agreement by 23.39 percentage points. Luna is therefore the least expensive
evaluated option that preserves acceptable business-rule behavior.

Artifacts for the current comparison:

- `runs/eval-openai-20260831T183514057Z/` — `gpt-5-nano`, 10-term batches.
- `runs/eval-openai-20260831T183837678Z/` — `gpt-4o-mini`, 50-term batches.
- `runs/eval-openai-20260831T184022528Z/` — `gpt-5.6-luna`, 50-term batches.

Official model pages used for the pricing snapshot:

- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)
- [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)
- [GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano)
- [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
