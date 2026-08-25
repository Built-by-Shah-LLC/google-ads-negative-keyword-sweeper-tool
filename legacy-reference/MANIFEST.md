# Legacy Cursor project reference

This directory preserves the relevant supporting material from the earlier Cursor project so the GitHub repository contains more than the generated handoff.

## Included

- Every Markdown document from the original project `docs/` directory.
- Every Cursor rule from the original `.cursor/rules/` directory.
- The original project README.
- Negative-sweeper HTML walkthroughs and email preview.
- The Daily Negatives Sweeper PDF walkthrough.
- The related MCC Hub-and-Spoke Engine JavaScript.
- The walkthrough logo asset used by the documentation.

The complete sanitized negative-sweeper and Apps Script source is stored separately under `handoff/source_code/`.

## Redactions and exclusions

- The live Hub spreadsheet URL in the MCC Engine was replaced with `HUB_SPREADSHEET_URL_PLACEHOLDER`.
- Live Google Ads customer IDs and recipient emails in sweeper code were already replaced with stable placeholders in `handoff/source_code/`.
- Email-address and dashed customer-ID examples in copied legacy text documents were normalized to `user@example.com` and `123-456-7890` before publication.
- The walkthrough video was not copied because the handoff states that it was not transcribed and is not required to reconstruct the sweeper.
- Unrelated generated files and local metadata such as `.DS_Store` are excluded.

These files describe historical designs. They are reference evidence, not controlling instructions for the AI-assisted rebuild.
