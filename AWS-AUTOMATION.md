# Automatic WordMemo deployments

The workflow in `.github/workflows/deploy.yml` tests and builds the app, obtains
temporary AWS credentials with GitHub OIDC, deploys the backend, checks private
account saving and group permissions with synthetic accounts, publishes to the
existing Amplify URL, and compares the public files with the release.

The initial AWS authorization must run in the account owner's existing console
session. Connecting GitHub alone does not authorize access to AWS.

## One-time authorization

Open [AWS CloudShell in Oregon](https://us-west-2.console.aws.amazon.com/cloudshell/home?region=us-west-2)
in account **912390896286**. Use an existing session that can create WordMemo's
IAM roles and resources. No new IAM user or access key is needed.

Download `scripts/authorize-aws.py` from the reviewed repository commit and run:

```bash
python3 WordMemo-authorize-aws.py --apply
```

ChatGPT supplies the exact commit-pinned download command with the handoff.
Running the file without `--apply` displays the trust and scope without changing
AWS. The script prints **WordMemo GitHub access is ready** when complete. Return
to ChatGPT with that message so the workflow can be rerun. You can also choose
**Actions → WordMemo deployment → Run workflow → main** yourself.

The initial workflow run is expected to stop at AWS authentication until this
setup has been run. Build failures before that step are unrelated to AWS access.

## What the setup creates

| Item | Scope |
| --- | --- |
| GitHub OIDC trust | `mahdiazizProjects/WordMemo`, repository ID `1368281544`, owner ID `34470394`, `main` branch |
| `WordMemoGitHub-d3p8fj75zj86rx` | Publish the existing Amplify production branch; manage the one backend stack through the restricted CloudFormation role; run account checks; read infrastructure status |
| `WordMemoCloudFormation-d3p8fj75zj86rx` | WordMemo table, Lambda, logs, runtime role, exact Cognito pool and exact HTTP API |
| `WordMemoRuntimeBoundary-d3p8fj75zj86rx` | Caps runtime role access at the WordMemo progress table and function logs |
| `/wordmemo/d3p8fj75zj86rx/deployment` | SSM String parameter with resource identifiers; no credentials |
| Cognito pool and HTTP API, if missing | Preallocate WordMemo resource IDs so IAM permissions can target exact resources |

The setup reuses this account's GitHub OIDC provider if present. It adds the
`sts.amazonaws.com` audience only if needed, without removing existing audiences.
The IAM roles cannot modify their own permissions or trust, modify the boundary,
create IAM users or access keys, access unrelated pools/APIs, or delete the
WordMemo table, user pool, or backend stack. The GitHub role cannot read Google
OAuth secrets; the CloudFormation role can resolve only secrets under
`wordmemo/google/d3p8fj75zj86rx/` for provider updates.

Two read-only AWS operations cannot be resource-scoped: describing Cognito
domains and listing log group metadata. These are limited to Oregon. They do
not grant access to other users' records or log contents.

The live integration checks need pool-wide Cognito account administration and
query/delete access to the WordMemo table. Cognito IAM cannot restrict the admin
password API to synthetic usernames. The test code creates two random
`example.invalid` accounts with messages suppressed and cleans up only the
accounts and record partitions it created. Access is limited to WordMemo, but
someone able to change a trusted main-branch workflow can affect WordMemo users
and data. Keep write access to the repository with trusted maintainers.

## Existing installations and failed deployments

The bootstrap reuses CloudFormation-owned pools/APIs. If it creates a missing
pool/API, those resources remain outside the backend stack and are recorded in
SSM; they are not recreated on later runs. Retain this configuration. Their
initial settings are maintained in `scripts/authorize-aws.py`. The pool has
deletion protection. The API is inactive until the backend creates its routes.

The installer preserves previously configured Google sign-in. Connecting a new
Google OAuth registration still needs the separate Google account setup in
[AWS-DEPLOY.md](AWS-DEPLOY.md). OAuth credentials must be entered in CloudShell,
never committed to GitHub or pasted into chat.

New automatic deployments preserve resources after a CloudFormation failure so
a corrected template can retry `CREATE_FAILED` or `UPDATE_FAILED`. A previous
`ROLLBACK_COMPLETE` or `UPDATE_ROLLBACK_FAILED` stack needs diagnosis first. The
workflow reports its failed resource and reason; it never deletes persistent
resources or replaces an account pool to make a retry succeed. Recovery that
needs additional permissions is handled separately after inspecting the actual
failure. Automatic deployment is not a promise that all possible AWS account
policies or rollback states can be repaired without another owner action.

## Public repository and logs

This repository was public when connected. Source and Actions logs are visible
to others. No AWS credentials or Google secrets belong in the source. Normal
diagnostics include stack/resource status and sanitized failure messages, not
raw Lambda logs, account tokens, email addresses, or learning records.
Change repository visibility in GitHub Settings if you want private source.

## Revoke access

In IAM, remove the `WordMemoOnly` inline policy from
`WordMemoGitHub-d3p8fj75zj86rx` and revoke its active sessions to stop deployment
access. Removing only its trust stops new sessions but does not immediately end
credentials already issued (maximum two hours). Do not delete the shared GitHub
OIDC provider, the runtime boundary, or app data to revoke deployment access.

## Validation and references

The workflow runs TypeScript, app tests, deployment control-flow tests, backend
integration tests, access-boundary checks, CloudFormation lint, and the web
release build. Local checks do not prove AWS permissions or Google sign-in work
in the real account; those require the authorized workflow and browser checks.

The access design follows [GitHub's AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[AWS CloudFormation service roles](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html),
and the AWS IAM references for [Cognito](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cognito-idp.html),
[API Gateway](https://docs.aws.amazon.com/service-authorization/latest/reference/list_apigatewayv2.html),
and [Amplify](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amplify.html).
