# WordMemo — learning together

**Automatic AWS deployment:** see [AWS-AUTOMATION.md](AWS-AUTOMATION.md) for the
one-time GitHub OIDC authorization. Pushes to `main` then run checks and publish
to the existing Amplify app using temporary, app-scoped AWS access.

The two largest data files are stored as compressed parts in `content/packed/`
to keep repository uploads small. `npm ci` automatically restores the complete
`src/data/bible.json` and `src/data/annotations.json`, verifies their SHA-256
checksums, and needs no Bible download. After editing those generated files,
run `npm run pack:data` to update the source parts.

A quiet, offline Scripture memory app for Android and iPhone, built with React Native and Expo. The project now includes the complete 66-book World English Bible Protestant Edition (WEBP), a five-box Leitner scheduler, reference/keyword/topic search, and offline chapter reading.

The design retains its ivory, olive, and gold palette, small cross, and readable Scripture typography. A public web build is now prepared for AWS Amplify; see [AWS-DEPLOY.md](AWS-DEPLOY.md). Native APK/IPA distribution still requires device testing and signing.

## Browser accounts and life groups

The existing app is at **https://production.d3p8fj75zj86rx.amplifyapp.com/**. This v2 source is prepared for upgrading that same AWS Amplify deployment; it has not been published from this workspace. See [AWS-DEPLOY.md](AWS-DEPLOY.md) for the self-contained CloudShell installer and one-time Google connection.

- Correct recall earns 10 XP; practice earns 3 XP. Completing the daily goal earns 25 XP once per day. Levels, six milestones, and gentle celebrations reward returning, with no missed-day penalty.
- Amplify Auth/Cognito sign-in, with Google after OAuth setup and hosted email sign-in as another option. Accounts save reviews, settings, favourites, rewards, and private stacks to DynamoDB.
- Private groups with expiring invitations, a chosen display name, optional progress summaries, shared stacks, and a host-led practice room. Members can copy shared stacks into their own learning.
- A private stack contains up to 200 selected cards. Group rooms use up to 30 cards; the host reveals and advances while participants self-grade. Group responses are extra practice and do not change personal Leitner schedules or XP.
- Device-local caching and offline queues preserve personal practice while disconnected. Guest progress is imported only with explicit choice. Three-way merging and optimistic revisions protect changes from another device.

The web build includes phone home-screen icons and versioned offline caching. A new release activates after all WordMemo windows close. Native exports retain offline practice and stack editing; native account/group sign-in requires a signed deep-link integration and is not implemented by this browser adapter.

To rebuild the deployment download, run `npm run package:aws`. Outputs are written to `release/`. The installer supplies account configuration and rebuilds the offline cache. The raw web ZIP has account services off and should not replace the configured production release directly.

## What is included

- All 66 books and 1,189 chapters of WEBP, copied from the publisher.
- 31,103 source verse-number entries: 31,098 with main text available as memory cards, plus five textual-note entries. The five notes remain visible in the reader and are excluded from practice.
- 42 topic collections. A verse can belong to several topics.
- 421 editorial passage selections covering 1,774 distinct verses; additional word/phrase rules provide labeled keyword suggestions.
- Every verse has a book, testament, book-level literary section, and extracted keywords where meaningful words are present. Full-text search remains available even when no devotional topic is assigned.
- Search references such as `John 3:16`, `Jn3:16`, `Psalm 23`, or `John 3:16-18`; search wording, topic names, and topic synonyms.
- Browse every book/chapter, open a verse as a memory card, and read its chapter offline. Add individual verses, a chapter, or a curated topic collection to My verses.
- A virtualized Bible list, canonical reference ordering, and curated selections first in topic results.
- Daily goals from 1–30 distinct passages, a separate new-passage cap, and due reviews before new material.
- Independent Leitner progress for verse wording and reference recall. Self-grade only after revealing the answer.
- Five review intervals: 1, 3, 7, 14, and 30 calendar days. A correct answer moves up one box; a miss returns to Box 1. Missed days preserve progress.
- Topic recall as optional ungraded practice; saved favorites; seven-day activity and five-box progress.
- Optional native daily notifications, device read-aloud, larger Scripture text, cached progress, and validated backup export/combine.

The original 30 starter selections remain available, including their multi-verse ranges, so existing backup and review IDs remain compatible. A range is one practice item. The default active collection remains small; including the full Bible does not automatically enroll every verse.

## Run

Use Node.js 24 LTS. Checked with Node 24.19.0, Expo SDK 57, React Native 0.86.3, and React 19.2.3. Dependency versions are recorded in `package-lock.json`.

```bash
npm ci
npm start
```

Use a compatible Expo Go client, or build a native preview. `npm run android` opens an Android emulator; `npm run ios` opens an iOS simulator on a Mac; `npm run web` opens the browser build. Daily notifications are native-only. Device speech availability depends on installed voices.

## Installable builds

Change `com.example.wordmemo` in both platform identifiers in `app.json` to identifiers you control. Then configure your Expo build project:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

The preview profile produces an Android APK. An iPhone preview requires Apple signing and registered test devices:

```bash
npx eas-cli@latest build --platform ios --profile preview
```

For broader iPhone testing use TestFlight; public releases require the appropriate store submission. Signing accounts and store releases are not created by this project. See [Expo build setup](https://docs.expo.dev/build/setup/) and [internal distribution](https://docs.expo.dev/build/internal-distribution/).

## How categorization works

`content/topics.json` is the editable taxonomy: category names, synonyms, word/phrase patterns, and explicit curated reference ranges. `scripts/classify-bible.py` applies it to the complete text and extracts up to six distinctive keywords per verse.

A curated assignment means the verse was selected editorially as part of a relevant passage. A keyword suggestion means its text matches a listed word or phrase. Suggestions can include negative examples or another speaker’s words; they do not assert that the verse endorses the topic. The app shows this distinction, offers a curated-only filter, and exposes source ranges on the verse detail screen.

This is a transparent first categorization pass, not a claim that every verse has received an independent theological review. Narrative, genealogical, and other verses without a fitting devotional label remain fully organized and searchable. See `CORPUS.md` for exact coverage and all topic counts.

## Scripture provenance and refresh

Text is copied from [eBible.org’s public-domain WEBP](https://ebible.org/engwebp/). No Bible quotations are generated. The importer compares every verse reference between the publisher’s VPL and HTML archives. The VPL wording is preserved without changing words, punctuation, or capitalization. Psalm superscriptions and the five note-only references are retained separately.

```bash
python scripts/import-bible.py
python scripts/classify-bible.py
```

The importer uses a sibling `corpus-cache` directory; pass `--cache /your/path` to change it. Both scripts use the Python standard library. Generated data, source URLs, counts, and checksums are bundled. Review any text changes before release; do not silently replace wording a person has been memorizing.

This package includes the 66-book WEBP canon. Catholic/Orthodox additional books and other translations are not included. They need separately identified source editions; memory progress must remain tied to the chosen translation.

## Project map

| File | Purpose |
| --- | --- |
| `App.tsx` | Onboarding, Today, flashcards, verse details, topic recall, Journey |
| `src/BibleScreen.tsx` | Full-Bible search, topic/book/chapter filters, virtualized results |
| `src/ChapterScreen.tsx` | Offline chapter reader and chapter enrollment |
| `src/SettingsScreen.tsx` | Goals, reminders, text size, backup/restore |
| `src/leitner.ts` | Pure scheduler, date handling, duplicate protection, backup validation |
| `src/bible-model.ts` | Full-Bible card model and compatible starter ranges |
| `src/catalog.ts` | Catalog, ID lookup, chapter index, and search index |
| `src/search.ts` | Reference parsing and combined content/category filters |
| `src/storage.ts`, `src/learning-store.ts`, `src/sync-merge.ts` | Scoped local caches, queued saves, migration, and conflict resolution |
| `src/auth-api.web.ts`, `src/AccountPanel.tsx` | Amplify OAuth sign-in and account saving status |
| `src/GroupsScreen.tsx` | Private stack editor, life groups, invitations, and shared rooms |
| `src/rewards.ts`, `src/Celebration.tsx` | Derived XP, milestones, and reduced-motion-aware celebrations |
| `backend/handler.py`, `backend/template.json` | Authenticated API and deployable AWS infrastructure |
| `scripts/build-backend.py` | Builds the template from readable API source and catalog metadata |
| `scripts/backend-deploy.inc.py` | Backend deployment, Google secret setup, and live smoke checks |
| `src/reminders.ts` | Permission-aware local notifications |
| `content/topics.json` | Editable topic rules and editorial passage selections |
| `scripts/import-bible.py` | Complete, verified publisher import |
| `scripts/classify-bible.py` | Reproducible topic annotations and keywords |
| `src/data/` | Complete Bible, metadata, annotations, provenance, and reports |
| `tests/` | Scheduling, full-corpus integrity, search, and categorization checks |
| `CORPUS.md` | Corpus totals, topic counts, method, and limits |
| `PRODUCT.md` | Product behavior and proposed next features |
| `VALIDATION.md` | Verification and remaining device checks |

## Verify

```bash
npm run typecheck
npm test
npm run export:all
```

No server, account, API key, or analytics is needed for bundled practice, searching, or chapter reading. Guest progress stays on the device. Signed-in browser progress saves privately to AWS after configuration; wait for the Saved status before changing devices. On phones, backup export shares JSON text; paste that text to restore. Combining a backup retains duplicate protection and turns reminders off until enabled on the current device.

Framework references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [local notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [Expo speech](https://docs.expo.dev/versions/v57.0.0/sdk/speech/).


## Authentication, data, and operational limits

Authentication uses the official `aws-amplify` v6 SDK with an existing Cognito user pool, OAuth code flow, and PKCE. The app's public configuration is `wordmemo-config.json`. Session tokens use browser session storage, so signing in again after a tab/browser session ends can be expected. Learning is retained in DynamoDB, independent of that login session. No AWS credential is shipped in the frontend.

Account caches are keyed by pool and Cognito subject. Original `wordmemo.v1` guest data is retained. A failed sync or import leaves a local copy. The server accepts only the known WordMemo schema and catalog identifiers; it never accepts client-selected ownership, arbitrary verse text, or direct table access. Only self-reported progress summaries are exposed when a group member opts in; XP is a learning aid, not an anti-cheat competition.

Limits: 50 personal stacks, 200 cards per stack, 20 groups per account, 50 members and 50 shared stacks per group. Invitations last 7 days; one practice room per group lasts up to 6 hours and uses at most 30 cards. Room updates poll every 3 seconds while visible, not WebSocket streaming. Group actions require a connection and are not queued offline. Rooms and responses are temporary; personal learning and stacks remain durable. Snapshot limits are 4.5 MB JSON and 1.8 MB compressed, with a clear save error and backup option if exceeded.

Current snapshots never expire. Retired snapshots receive a seven-day TTL; DynamoDB recovery backups retain historical data. AWS usage costs depend on active users, polling, storage, and backups. No ads or application analytics are added. See the shipped privacy page and [OPERATIONS.md](OPERATIONS.md) for maintenance and deletion requests.
