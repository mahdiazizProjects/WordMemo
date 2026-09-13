# Update the existing WordMemo app

For deployments managed through GitHub, start with
[AWS-AUTOMATION.md](AWS-AUTOMATION.md). The manual installer below is retained
for direct CloudShell use and the one-time Google OAuth credential entry.

The previous app is already live at **https://production.d3p8fj75zj86rx.amplifyapp.com/**. This v2 upgrade has been built and checked locally, but has not been deployed from this workspace. There is no authenticated AWS session available here. The installer runs the upgrade using your existing AWS CloudShell session and preserves that same public link.

## Install the upgrade

1. Download the **new** `WordMemo-deploy-aws.py` from this conversation.
2. Open [AWS CloudShell](https://console.aws.amazon.com/cloudshell/home) in account **912390896286**, **US West (Oregon)**. Use the standard CloudShell environment.
3. Choose **Actions → Upload file**. Upload the new file, replacing the older file with the same name.
4. Run this in CloudShell, not in Windows:

```bash
python3 ~/WordMemo-deploy-aws.py
```

The installer sets up email accounts, private cloud saving, groups, shared stacks, and group rooms, then updates the existing Amplify app. It verifies the backend before publishing, then compares the public files against the release. Wait for **“WordMemo is live and its public files are verified.”** Close every WordMemo tab and installed-app window, then reopen your usual link to activate the upgrade.

Email sign-in works after this first deployment. Google is enabled by the one-time step below. You can also connect Google before the first deployment using `--configure-google` once you have its OAuth registration ready. AWS hosting, account, database, API, function, backup, and optional secret storage usage charges apply; the installer does not promise a zero bill.

## Connect Google once

AWS handles the app side, but Google requires your own OAuth registration. Nothing in the app or source package contains your Google client secret.

In your [Google Cloud console](https://console.cloud.google.com/auth/overview), choose a project and set up Google Auth Platform. Use **External** audience if your friends use personal accounts. Set the app name to **WordMemo**, choose your own support/developer email, and provide the app homepage and privacy page:

- Homepage: `https://production.d3p8fj75zj86rx.amplifyapp.com/`
- Privacy: `https://production.d3p8fj75zj86rx.amplifyapp.com/privacy.html`

Create an OAuth client of type **Web application** with these exact values:

| Google field | Value |
| --- | --- |
| Authorized JavaScript origin | `https://wordmemo-912390896286-d3p8fj75zj86rx.auth.us-west-2.amazoncognito.com` |
| Authorized redirect URI | `https://wordmemo-912390896286-d3p8fj75zj86rx.auth.us-west-2.amazoncognito.com/oauth2/idpresponse` |

Request only **openid, email, profile**. For general access, move the consent configuration out of **Testing**; while it remains in Testing, add each friend as a test user. Complete any verification Google asks for in your account. See the official [AWS Google-provider setup](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html) and [Amplify social sign-in guide](https://docs.amplify.aws/react/build-a-backend/auth/add-social-provider/).

Then run:

```bash
python3 ~/WordMemo-deploy-aws.py --configure-google
```

The script prompts for the Google OAuth client ID and then the client secret, hidden while you enter it. Enter them **in CloudShell only**, not in chat. It stores them in AWS Secrets Manager, connects the Cognito Google provider, and publishes the Google sign-in button. The public config includes only the Cognito public client ID, pool/domain, API address, and app URL.

Later normal deployments preserve the existing Google connection. Running `--configure-google` again creates a new secret and updates the provider. Previous secrets are retained; retire unused versions in Secrets Manager after confirming the new sign-in works.

## What is created and verified

- Reuses Amplify app **d3p8fj75zj86rx** and branch **production**. It checks the AWS account, app ownership tag, app type, and public branch configuration before proceeding. It stops if that existing app is missing; it does not create a replacement URL.
- CloudFormation stack **wordmemo-sync-d3p8fj75zj86rx** creates a Cognito user pool and public OAuth client; an encrypted DynamoDB table with backups and deletion protection; an authenticated HTTP API; and a Lambda function with access to that table and its own logs.
- Cognito uses authorization code flow; Amplify handles the OAuth redirect and PKCE. API access requires a Cognito access token and scope. There is no public database API key and no browser-held AWS secret.
- Backend verification creates two temporary synthetic accounts with email sending suppressed. It checks sign-in, isolation of private progress, conflicting writes, membership restrictions, sharing opt-in/out, host permissions, and duplicate room responses. It removes only those temporary accounts and records. The existing frontend is not replaced if those checks fail.
- Runtime configuration is inserted into the web ZIP and the offline cache version is rebuilt. The final archive hash is used for resumable publishing. Public verification checks HTML, JavaScript, manifest, worker, account configuration, and privacy page.

A local `WordMemo-backend.json` records non-secret resource identifiers. The deployment record has no credentials or signed upload URLs. Do not delete the Cognito pool or DynamoDB table to troubleshoot a frontend issue. Critical resources have retention policies and deletion protection.

## If a step fails

Rerun the same command to resume a running backend deployment or verify a known hosting job. If a hosting job actually failed, fix its reported cause before using `--new-deployment`. If CloudFormation reports a failed/rolled-back stack, use its Events tab to find the failed resource; the installer does not delete stacks or user data to force a retry.

If AWS reports `AccessDenied`, share only the non-secret error text. The deployment identity needs CloudFormation management, Cognito management (including the temporary-account checks), DynamoDB management/data access for those checks, Lambda, API Gateway, CloudWatch Logs, role creation/policy management and `iam:PassRole`, plus Amplify publishing. Connecting Google additionally needs Secrets Manager access. Use an existing authorized administrator/role rather than creating permanent access keys for chat. The deployed app itself receives only its narrowly scoped Lambda role.

A read-only account/package check is available:

```bash
python3 ~/WordMemo-deploy-aws.py --check-access
```

The bundled download can be checked without AWS or extra Python packages:

```bash
python3 WordMemo-deploy-aws.py --verify-package
```

## First real-device check

After deployment, sign in, import your guest progress if it belongs to you, finish a review, and wait for **Saved to your account**. Open another browser/device and sign in with the same method; the review, reward, and stack should return. Then create a group, invite a friend, share a stack, and host a room from two devices.

Use the same sign-in method each time. Email-password accounts and Google accounts are not automatically linked by matching email addresses. Automatic email-based linking would allow unsafe account takeover paths. If you already used email before switching to Google, export your backup, sign in with Google, and combine the backup into that account in Settings.

The app works offline for personal practice. Account sign-in and group actions need a connection. Guest progress remains device-only until you choose to import it. Native APK/IPA cloud sign-in needs signed deep-link integration; this upgrade's account/group sign-in targets the public browser app.

## Rebuild from source

```bash
npm ci
npm run typecheck
npm test
npm run test:deploy
npm run package:aws
```

The new installer and web archive are in `release/`. `WordMemo-AWS-web.zip` is the **unconfigured** build with account services off; use the installer so it receives the correct backend configuration. Do not manually upload that unconfigured ZIP over the configured production app.

Python 3.12 with `tests/requirements.txt` is needed only for backend integration/lint checks. CloudShell already supplies Python, AWS CLI, and boto3 for the installer. No Python installation on Windows is needed.
