# Corpus and categorization record

The complete World English Bible Protestant Edition (WEBP), downloaded from its publisher on 9 September 2026. This is the 66-book Old/New Testament edition.

| Measure | Count |
| --- | ---: |
| Books | 66 |
| Chapters | 1,189 |
| Source verse-number entries | 31,103 |
| Verse entries with main text | 31,098 |
| Note-only entries | 5 |
| Topics | 42 |
| Editorial passage selections | 421 |
| Distinct verses with curated topics | 1,774 |
| Distinct verses with any topical assignment | 11,293 |
| References organized only by book/section, without devotional topics | 19,810 |
| Extracted keyword vocabulary | 12,047 |

Every reference has book, testament, and book-level literary-section metadata. Keywords are extracted from verse text; very short verses containing only common words may have no distinctive keyword. All wording remains full-text searchable. Topic totals overlap because one verse may fit several topics.

## The three layers

1. Structural categories: book, testament, and a broad book-level literary section. These provide complete navigational coverage, not a claim that a whole book has only one literary genre.
2. Curated topics: explicit editorial selections of relevant passages. For example, James 1:2–4 belongs to perseverance because it connects testing with endurance. The app retains the selected passage range so neighboring context is visible.
3. Keyword suggestions: reproducible whole-word or phrase matches. These are labeled as suggestions because a word may occur in a warning, a negative example, a quotation, or another speaker’s claim. They are not presented as verified theological interpretations.

The classifier does not force every narrative verse into a devotional theme. It also does not treat every occurrence of “fear” as anxiety: reverence language requires different interpretation. This first pass has not undergone independent theological review.

## Topic counts

| Topic | Group | Curated verses | Keyword suggestions |
| --- | --- | ---: | ---: |
| Perseverance | In difficult seasons | 34 | 166 |
| Peace | In difficult seasons | 22 | 389 |
| Hope | In difficult seasons | 55 | 132 |
| Faith & trust | Walking with God | 83 | 682 |
| Love & compassion | Life together | 82 | 661 |
| Wisdom | Walking with God | 45 | 524 |
| Prayer | Walking with God | 55 | 331 |
| Forgiveness | Life together | 62 | 126 |
| Grace & mercy | Walking with God | 57 | 458 |
| Salvation | The story of Scripture | 62 | 506 |
| Repentance | Walking with God | 46 | 113 |
| Humility | Walking with God | 37 | 167 |
| Gratitude | Walking with God | 40 | 153 |
| Joy | Walking with God | 34 | 414 |
| Courage | In difficult seasons | 32 | 160 |
| Worry & fear | In difficult seasons | 42 | 258 |
| Grief & loss | In difficult seasons | 55 | 416 |
| Comfort & refuge | In difficult seasons | 68 | 208 |
| Strength in weakness | In difficult seasons | 33 | 271 |
| Guidance | Walking with God | 21 | 49 |
| Obedience | Walking with God | 40 | 143 |
| Holiness | Walking with God | 26 | 705 |
| Justice | Life together | 37 | 317 |
| Generosity | Life together | 32 | 14 |
| Service | Life together | 64 | 1,356 |
| Unity & community | Life together | 58 | 342 |
| Family | Life together | 53 | 631 |
| Friendship | Life together | 21 | 137 |
| Work & diligence | Life together | 27 | 909 |
| Words & truth | Life together | 40 | 180 |
| Temptation & self-control | Walking with God | 38 | 67 |
| Worship & praise | Walking with God | 37 | 595 |
| Creation | The story of Scripture | 90 | 134 |
| Covenant & promise | The story of Scripture | 59 | 407 |
| The Holy Spirit | The story of Scripture | 82 | 107 |
| Resurrection | The story of Scripture | 144 | 83 |
| Eternal life | The story of Scripture | 41 | 39 |
| The kingdom of God | The story of Scripture | 90 | 84 |
| Leadership | Life together | 68 | 338 |
| Money & contentment | Life together | 42 | 353 |
| God’s Word | Walking with God | 48 | 152 |
| Sharing the good news | Life together | 38 | 377 |

## Exact text and numbering

Verse text is copied unchanged from the publisher’s VPL archive. Reference coverage was independently checked against its HTML archive: every book/chapter/verse entry matched. All chapter numbers and in-chapter verse numbers were checked for continuity. The importer aborts on duplicate, unknown, or missing references.

WEBP has five note-only reference entries: Luke 17:36, Acts 8:37, Acts 15:34, Acts 24:7, and Romans 16:25. They are displayed with their publisher notes and cannot be enrolled as empty flashcards. Romans 16:25’s note points to the doxology numbered Romans 14:24–26 in this edition; text is not silently copied into numbering from another edition.

Verse counts vary by edition. This project follows the publisher’s exact numbering instead of imposing the count from a different translation. Psalm superscriptions are retained outside numbered verse text.

## Rebuild and improve the categories

Edit `content/topics.json` to add or adjust topic definitions and curated reference ranges. Run `python scripts/classify-bible.py`, inspect the generated report, and run `npm test`. Unknown curated references stop the classifier. Each annotation distinguishes curated evidence from a lexical suggestion. Scripture text stays separate from editorial metadata.

For a later reviewed catalog, have qualified reviewers assess passages in context, record reviewer/version metadata, and promote only agreed assignments. Do not relabel keyword suggestions as curated merely to increase coverage.

## Sources

- [Publisher’s complete WEBP](https://ebible.org/engwebp/)
- [Download formats](https://ebible.org/find/details.php?all=1&id=engwebp)
- [Public-domain declaration](https://ebible.org/engwebp/copyright.htm)
- [Romans numbering note](https://ebible.org/engwebp/ROM16.htm)

Archive and generated-content checksums are in `src/data/bible-provenance.json`; classification checksums and coverage are in `src/data/classification-report.json`.
