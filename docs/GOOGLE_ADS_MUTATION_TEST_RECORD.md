# Google Ads mutation test record

## Status

- Test date: 2026-09-10
- Code under test: campaign-level exact negative-keyword mutation
- Overall result: both the non-persisting validation path and the isolated Google Ads test-account write path passed
- Production-account mutation: not tested and not authorized by these results

This document records the two live Google Ads API checks used to test the newly added mutation code. Unit tests with injected transports are separate and are not the subject of this record.

## Results summary

| Method | Google Ads request behavior | Observed result | Persisted an Ads change |
| --- | --- | --- | --- |
| Validation-only | Sent one `campaignCriteria:mutate` request with `validateOnly: true` | Two requests returned `VALIDATED` with no errors | No |
| Google Ads test account | Confirmed `customer.test_account = true`, validated the operation, sent the real mutation, and queried Google Ads afterward | One exact campaign negative was applied and verified | Yes, in the test account |

## Method 1: validation-only request

### Purpose

This check exercised live authentication, account and campaign targeting, the Google Ads mutation endpoint, and the exact-negative request shape without allowing Google Ads to persist a change.

The dedicated validation writer sends exactly one request with `validateOnly: true`. It has no path that can send `validateOnly: false`.

### Command

```powershell
npm run mutation:validate -- --auto-select-one
```

An explicit target can also be supplied:

```powershell
npm run mutation:validate -- --customer CUSTOMER_ID --campaign CAMPAIGN_ID
```

### Observed live results

The validation was run twice against customer `8847499121`, campaign `23986654523`, using the proposed exact-negative text `sweeper validation only 2026-09-10`.

| Completed at (UTC) | Google request ID | Status | Resource name | Error |
| --- | --- | --- | --- | --- |
| 2026-09-10 11:37:52 | `KCAFyv_arILgdbzNn7iQTQ` | `VALIDATED` | `null` | `null` |
| 2026-09-10 11:40:08 | `trao8MO40JuuShJ5vYSP3w` | `VALIDATED` | `null` | `null` |

Both audit records explicitly contain:

```json
{
  "validateOnly": true,
  "googleAdsMutationPerformed": false
}
```

A follow-up Google Ads read found no matching persisted negative. That follow-up read was observed during testing but was not written into the validation artifact.

### Evidence

- `runs/validation-only-1789040272345/mutation-validation.json`
- `runs/validation-only-1789040408223/mutation-validation.json`
- Runner: `scripts/validate-google-ads-mutation.ts`
- Validation-only writer: `src/google-ads/negative-keyword-writer.validation.ts`

### What this established

- The credentials and developer token could reach the live Google Ads API.
- Google Ads accepted the customer-scoped campaign criterion request shape.
- The proposed campaign-level exact negative passed Google Ads validation.
- No campaign criterion was created by either validation-only request.

This method did not prove that a real mutation could be persisted or read back, which is why the separate test-account check was performed.

## Method 2: real mutation in a Google Ads test account

### Purpose

This check exercised the complete production mutation sequence while restricting the write to Google's isolated test-account environment:

1. Load credentials only from the ignored `.env.google-ads-test` file.
2. Select or accept a test customer and campaign.
3. Query `customer.test_account` immediately before writing and require it to be `true`.
4. Require the exact confirmation phrase.
5. Send the operation through `validateOnly: true` first.
6. Send the real `campaignCriteria:mutate` operation with `validateOnly: false`.
7. Query existing campaign negatives and require the created exact negative to be present.

### Command

```powershell
npm run mutation:test-account -- `
  --auto-select-one `
  --confirmation WRITE_ONE_EXACT_NEGATIVE_TO_GOOGLE_TEST_ACCOUNT
```

An explicit test target can be supplied with `--customer TEST_CLIENT_ID --campaign TEST_CAMPAIGN_ID` instead of `--auto-select-one`.

### Observed live result

- Started: 2026-09-10 12:17:38 UTC
- Completed: 2026-09-10 12:17:42 UTC
- Test customer: `3629748374`
- Test campaign: `24231423090`
- Exact-negative text: `sweeper api test 2026-09-10 bbe9c32e`
- Final mutation request ID: `xvCmuHaH4d5NCjO9zeGoOA`
- Created resource: `customers/3629748374/campaignCriteria/24231423090~2502086151584`
- Result status: `APPLIED`
- Proposed: 1
- Attempted: 1
- Applied: 1
- Verified by read-back: 1
- Failed: 0
- Unknown or ambiguous: 0
- Verification error: none

### Evidence

- `runs/test-account-mutation-1789042658043/mutation-smoke.json`
- Runner: `scripts/smoke-test-google-ads-mutation.ts`
- Test-account guard and smoke workflow: `src/google-ads/test-account-mutation-smoke.ts`
- Production request writer used by the smoke test: `src/google-ads/negative-keyword-writer.prod.ts`

### What this established

- The safety check identified the target as a Google Ads test account before mutation.
- The same writer used for production-shaped requests passed its validation preflight.
- Google Ads created one campaign-level exact negative and returned its resource name.
- The application mapped the response to the original operation.
- The post-mutation Google Ads read found the created negative, proving that the write persisted in the test account.

The smoke test does not delete the created criterion. The exact negative therefore remains in the Google Ads test account unless it is removed separately.

## Storage and audit limitations

The audit JSON files above are stored locally under `runs/`. That directory is excluded by `.gitignore`, so the JSON evidence is not committed to Git and is not a durable backup. This Markdown file is the durable repository record of the observed results.

The audit files contain normalized operation details, statuses, errors, request IDs, and the created resource name. They do not contain complete raw HTTP request or response bodies. In particular:

- validation-only artifacts store the validation request ID and normalized result;
- the successful test-account artifact stores the final mutation request ID, but not the preceding validation request ID;
- raw read-back query rows are not stored; only the resulting `verifiedCount` and verification status are recorded;
- OAuth access tokens, refresh tokens, client secrets, and developer tokens are not stored in these artifacts or in this document.

## Conclusion

Together, the two methods demonstrated that the mutation payload was accepted without persistence when `validateOnly: true`, and that the guarded production-shaped path could create and verify one exact campaign negative in a Google Ads test account. These checks do not constitute approval to enable production mutation mode or to mutate a non-test Google Ads account.
