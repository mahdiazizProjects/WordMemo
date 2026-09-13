# WordMemo service operations

The deployment owner operates this app in AWS account 912390896286. App users never need AWS access. Resource identifiers are written to `WordMemo-backend.json` by the installer. Keep the Cognito pool and DynamoDB table across frontend releases; recreating either is not an upgrade path.

## Saving and recovery

- Current progress is `PK = USER#<Cognito sub>`, `SK = head`, with revision and immutable compressed snapshot chunk identifiers. A transaction commits a complete generation and marks only the previous generation for TTL cleanup. The summary item contains server-derived aggregate counts.
- The API rejects a stale revision with HTTP 409. The client fetches and merges before retrying. Offline edits and an unfinished guest import remain in a scoped browser cache until acknowledged.
- Original guest storage is retained. Guest imports are a user's explicit choice; avoid importing another person's data on a shared device. Clearing storage before pending changes reach AWS can still lose those unsaved changes.
- Export a backup before manually changing stored data. Use DynamoDB point-in-time recovery into a separate table to inspect recovery candidates; never overwrite the production table blindly. Recovered copies must remain private.
- Browser caches and cookies are not a substitute for the database. Device copies remain after sign-out. Use separate browser profiles on shared devices and clear site storage if local copies should be removed.

## Account deletion requests

Confirm that the requester controls the account using the same sign-in identity. Resolve their exact Cognito `sub`; do not select accounts solely by a similar display name or merge identities by email. Explain that other people may keep copies of stacks deliberately shared with them.

Before deletion, record only the resource identifiers needed to perform the request, and offer the user an export if they want one. Disable the Cognito user and revoke its sessions. Existing access tokens can remain valid for up to one hour with the JWT authorizer; allow that validity period to end before deleting records so an old token cannot recreate them. Do not use user-facing logs or chat to transfer tokens.

For each group membership indexed under that subject: remove their membership and decrement the group's member count and user index. If they own a group, agree on closing it or an operator-assisted ownership transfer before removing the owner. Group closure is a soft close that revokes reads and writes; shared content can be retained for recovery unless deletion is requested. Remove the subject's own responses and their authored shared stacks if requested; copies other members saved cannot be recalled.

Delete the exact `USER#<sub>` partition, including all snapshot generations and summary, then delete the exact Cognito user. Do not scan/delete unrelated user partitions, delete the whole table, or delete the pool. Document completion. Retained AWS backups can continue to hold historic copies for their retention window (up to 35 days for point-in-time recovery); do not restore deleted accounts from backups without honoring the deletion record. Ask the user to clear cached copies on their own devices.

This is an operator procedure; there is not yet an in-app delete-account button. Use AWS administrator tools with a confirmed deletion request, and keep a record of the action.

## Google and sign-in

Use `--configure-google` to connect/rotate a Google OAuth registration. The secret lives in Secrets Manager; the public frontend contains only non-secret Cognito configuration. Use External audience and the proper Google publishing/test-user settings for your intended visitors. The cloud installer tests Cognito authorization with temporary email users; an actual Google consent redirect must still be verified with your Google account after its registration is connected.

Email and Google are distinct sign-in methods. They are not automatically linked on matching email. Users changing methods can export their own backup and combine it after signing in to the new account. A future account-link flow must prove control of both identities.

## Limits and monitoring

The API has a default throttle of 50 requests/second with burst 100. Practice rooms poll while visible every three seconds. Adjust based on observed traffic, budgets, and latency rather than opening unrestricted limits. A room supports up to the group's 50 members. Guest reading needs no API calls.

Cognito's default email delivery has service quotas; production use beyond a small trial may need Amazon SES configuration. Check the service's actual quotas in this account. Monitor CloudFormation failures, API 4xx/5xx, Lambda errors/throttles, DynamoDB throttles, and your AWS bill. Lambda logs contain only generic error/request identifiers and are retained for 14 days.

The table and pool use deletion protection and retention policies. Deleting the CloudFormation stack intentionally leaves those resources behind. Do not remove retention protections just to get a deployment to finish. Old Google secrets are retained when rotating; retire obsolete ones only after the new provider is working.
