# WordMemo v2 verification

Automation update, 13 September 2026: TypeScript, all **73 tests** (45 Node,
11 backend, 10 deployment, 7 access-boundary tests), CloudFormation lint, web
packaging, and embedded archive verification passed locally. The access tests
check repository trust, unrelated-resource denial, the runtime permissions
boundary, restricted CloudFormation role use, and failure behavior. AWS access
and live deployment still require the account owner's one-time authorization.

Prepared 12 September 2026. The original AWS app is live; this upgrade has not been deployed from this workspace.

| Check | Result |
| --- | --- |
| Strict TypeScript check | Passed |
| App, corpus, scheduler, rewards, sync, and offline-worker tests | 45 passed |
| Backend integration/security tests | 11 passed using Moto's DynamoDB implementation; no AWS network calls |
| AWS deployment control-flow/package tests | 10 passed with mocked AWS responses |
| Total automated tests | 66 passed, 0 failed |
| CloudFormation schema/security-property lint | Passed with cfn-lint 1.56.3 for us-west-2 |
| Web production export | Passed; 7.44 MiB uncompressed offline assets, approximately 2.08 MiB ZIP |
| Android and iOS JavaScript/Hermes exports | Both passed for this source revision; not signed native binaries |
| Self-contained AWS installer | Generated and compiled; embedded web archive checksum/integrity verified without AWS |
| Browser visual/interaction check | Blocked: remote browser returned ERR_BLOCKED_BY_CLIENT for the local preview |
| Real AWS infrastructure and Google OAuth redirect | Not exercised here; authenticated AWS and Google registration are unavailable in this workspace |
| Phone layout, animation, accessibility and actual offline behavior | Still require a real browser/device check |

## What the tests establish

The original full-Bible/source checks and Leitner rules remain covered. New client tests verify reward duplication protection, backup compatibility, concurrent distinct reviews, conflicting grades/directions, preserved paused verses, scoped account caches, guest import consent and retries, in-flight edits, account switching, revision conflicts, and rejection of corrupt remote data.

Backend tests run the actual Python handler against Moto's DynamoDB transaction implementation. They verify authenticated ownership, rejection of ID tokens/wrong clients, stale revisions, atomic chunk replacement, current-snapshot retention, invalid input rejection, invitation rotation/expiry, default private progress, opt-in/out summaries, membership restrictions, author/owner stack controls, host-only room advancement, duplicate responses, stale answers, removal during a transaction, and group closure without losing personal progress. These tests do not validate AWS IAM enforcement or the deployed API Gateway authorizer; those need the live checks.

The installer is pinned to the existing Amplify app. Tests verify wrong-account rejection, refusing a missing/unrecognized destination, no frontend publishing when backend setup fails, resumable hosting jobs, anonymous exact-file comparisons, and a new worker/cache hash when runtime account configuration changes.

During actual deployment, the installer will create two temporary Cognito users with messages suppressed and exercise live API authorization, private reads/writes, progress sharing, membership, and room controls. It removes those users and only their test partitions. It will not publish the frontend if those checks fail. This live verification has been implemented, but has not been run here.

## First-device acceptance

After deployment and Google registration, open the normal link in Safari and Chrome. Close all previous WordMemo windows first so the new worker can activate. Verify:

1. Sign in, explicitly import your guest copy, finish a review, and wait for **Saved to your account**.
2. Sign in with the same method on another browser/device and see that review, reward, and private stack.
3. Practise offline, reconnect, and check that the queued change becomes Saved. Duplicate grading must not award extra points.
4. Create a private group, join with an invitation from another account, and share/copy a stack. Progress should be hidden until the member opts in; opting out should hide it on refresh.
5. Start a room on one device and answer on another. Only the host can reveal or advance. Check lost connection, a stale answer, and closing the room.
6. Check long verses, larger text, small-screen layout, keyboard access, screen readers, reduced motion, and the animation-off setting.

Native exports confirm compilation and bundling. They do not prove APK/IPA signing, native runtime behavior, reminder delivery, or native Google redirects. The platform adapter deliberately retains guest/offline features on native; account and group sign-in are provided by the browser release in this upgrade.
