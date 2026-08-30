# OpenAI model evaluation

Evaluation date: `2026-08-31`

Rule set: `2026-08-27.1`

The production prompt and strict validation contract were run over all 124 labeled
handoff examples. Estimated cost uses standard token prices documented by OpenAI on the
evaluation date. The run artifact is ignored under
`runs/eval-openai-20260830T214614075Z/`.

| Model | Agreement | KEEP accuracy | Negative recall | Negative precision | False positives | Estimated run cost |
|---|---:|---:|---:|---:|---:|---:|
| `gpt-5-nano` | 73.39% | 92.45% | 59.15% | 91.30% | 4 | $0.007432 |
| `gpt-5.4-nano` | 91.94% | 94.34% | 90.14% | 95.52% | 3 | $0.015653 |
| `gpt-5.6-luna` | 96.77% | 98.11% | 95.77% | 98.55% | 1 | $0.012411 |
| `gpt-5.4-mini` | 98.39% | 96.23% | 100.00% | 97.26% | 2 | $0.052067 |

## Selection

Use `gpt-5.6-luna` with low reasoning effort. The older `gpt-5-nano` was cheapest, but
its 73.39% agreement, four false positives, and 29 false negatives are not production
quality. Luna cost about $0.005 more for the full evaluation while improving agreement
by 23.38 percentage points and reducing false positives to one. `gpt-5.4-mini` had the
highest overall agreement but cost about 4.2 times more than Luna and produced one
additional false positive. For negative-keyword automation, protecting relevant traffic
takes priority over minimizing token cost at the expense of decision quality.

Official model pages used for the pricing snapshot:

- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)
- [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
