# WordMemo v2 product update

Implemented in this release: personal XP and milestones, accessible celebration animations, browser account saving through Amplify/Cognito, private verse stacks, private life groups, opt-in progress summaries, expiring invitations, and shared practice rooms. Existing Leitner rules, full-Bible text, topic evidence, offline reader, and quiet visual palette remain in place.

Group practice is cooperative extra practice. The host controls reveal/advance; participants self-report recall and see collective counts. It does not count toward personal XP or reschedule cards. Add the stack to daily practice for individual spaced repetition.

Potential later work: shared weekly challenges with a durable group completion history, WebSocket room updates, fill-in-the-blank recall, bilingual cards, home-screen widgets, and signed native social sign-in. These are ideas, not implemented features.

---

## Original product notes (historical)

# WordMemo product brief

WordMemo helps a Christian recall a fitting Scripture passage, its wording, and its location when a topic comes up in everyday life. The experience should feel like opening a small prayer journal: quiet, readable, welcoming, and explicitly centered on Christ and Scripture.

The central promise is “Carry the Word with you.” A short daily rhythm is more useful here than a large, distracting dashboard.

## Three kinds of recall

| Practice | Front | Answer | Why it matters |
| --- | --- | --- | --- |
| Reference recall | Exact verse text, with translation | Book, chapter, verse or range | Locate a familiar passage |
| Verse recall | Book, chapter, verse or range | Exact text in the selected translation | Learn the wording |
| Topic recall | “What does Scripture say about perseverance?” | Examples of relevant passages | Retrieve Scripture when a situation calls for it |

A single passage can have several topics. For example, Galatians 6:9 appears under perseverance and hope. Topic labels are editorial aids, not claims that one verse has only one meaning. Chapter context is one tap away after an answer is revealed.

The first two modes have separate learning records. Knowing that a verse is Galatians 6:9 is not evidence that the learner can recite its words. The Both ways setting chooses a due direction; it does not score both directions from one answer. Topic recall is ungraded extra practice because many valid passages can answer a broad topic prompt.

## Daily rhythm

Choose a daily target, optionally restrict new passages, and open Today. The session draws from the learner's active collection. Overdue material comes before new passages; each distinct passage is practised at most once that day. Ranges such as Philippians 4:6–7 are one passage, and therefore one goal item.

The target is a daily cap. If a person chooses ten and only four eligible passages exist, the app offers four. A separate new-passage cap prevents an expanding workload from surprising the learner. Increasing the goal after a session makes additional eligible items available; decreasing it does not erase completed work.

| Box | Review interval | After a correct response |
| --- | --- | --- |
| 1 | 1 day | Move to Box 2; return in 3 days |
| 2 | 3 days | Move to Box 3; return in 7 days |
| 3 | 7 days | Move to Box 4; return in 14 days |
| 4 | 14 days | Move to Box 5; return in 30 days |
| 5 | 30 days | Stay in Box 5; return in 30 days |

An incorrect response from any box returns that recall card to Box 1, due the next calendar day. New cards begin at Box 1 before their first response. These intervals are product defaults; they are not presented as a uniquely optimal scientific schedule.

Leaving a session retains completed responses; ungraded items stay eligible. Missing days leaves cards overdue and preserves their boxes. No streak loss, guilt language, spiritual ranking, or competitive leaderboard is needed. Encouragement should acknowledge a practice session without implying that app activity measures faith.

## Design decisions

The light interface uses ivory (`#F6F3EC`), deep olive (`#294C3C`), and restrained gold (`#98733C`). A small cross in the app header and an open-Bible app mark give clear Christian identity. Generous spacing and serif Scripture typography keep the focus on reading. App text uses familiar labels: Today, Bible, Journey, and Your rhythm.

Each screen has one main task. Today begins a session. The card screen conceals the answer until revealed and offers two self-grades. Bible supports full-text discovery, topic and book filters, offline chapter reading, and collection management. Journey explains learning progress with five numbered boxes. Settings holds preferences and backup management.

The starter supports larger Scripture text and screen-reader labels. Production review should test VoiceOver, TalkBack, large system fonts, small phones, tablets, and long passage ranges. A dark theme is proposed, not included in the native starter.

## Proposed next features

| Priority | Feature | Concrete behavior |
| --- | --- | --- |
| Next | Fill-in-the-blank practice | Gradually hide words; compare against the selected translation; keep this score separate from unaided recall |
| Next | English–Persian cards | Optional language switching or parallel reading, right-to-left Persian layout, verified translation text, progress keyed by translation and language |
| Next | Home-screen widgets | Show an enrolled passage or a “Recall first” reference; open the relevant practice screen |
| Next | Custom passage ranges and personal tags | Combine adjacent verified verses into a new range; keep personal tags separate from curated categories |
| Later | Listen and repeat | Optional repeat counts and natural pauses, with downloadable licensed or public-domain audio |
| Later | Cross-device sync | Optional account and conflict-safe review events; local practice remains available offline |
| Later | Church or small-group collections | Share curated passage lists without exposing personal practice history |
| Later | Topic discovery in natural language | Search the verified corpus for a situation; always return actual passages and source references |
| Later | Personal notes | Keep reflections visually separate from Scripture text |

These are roadmap proposals, not completed starter features. The starter does not generate Bible quotations or assess theology using AI. It includes device text-to-speech, not a recorded Bible audio library.

## Growth path

Keep content, scheduling, and presentation separate. The full Bible is bundled as compact rows, with generated keyword/topic annotations and in-memory reference and chapter indexes. A virtualized list limits the rendered cards. Device state remains separate in AsyncStorage. A future SQLite migration could reduce startup parsing and support larger multi-translation catalogs while retaining the tested scheduling functions. Before sync, define durable event IDs, conflict rules, migration behavior, deletion semantics, and privacy choices. Keep the daily flow usable without creating an account.

The current passage IDs include the translation, book, chapter, and range. Review keys also include the tested direction. Future versions must add content revision handling rather than silently changing already memorized wording. User-created tags should reference passages through a many-to-many mapping.

The first release should prioritize correct text, predictable review timing, readable cards, reliable offline storage, and respectful reminders. Additional translations and learning aids can follow successful device testing.

## Complete Bible and topic coverage

The app includes every verse-number entry in the 66-book WEBP edition. Source wording is kept separate from topic metadata. Curated passage selections and automatic keyword suggestions remain visibly distinct, and all verse cards expose book/testament/literary-section metadata. See `CORPUS.md` for measured coverage. Selecting a curated topic can enroll its verses in one action; the daily cap still applies.
