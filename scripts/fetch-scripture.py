"""Refresh the explicitly selected public-domain WEBP passages from their publisher.
Run with Python 3. No API keys or third-party packages. Existing output changes
only after every passage downloads and validates. Review diffs before release.
"""
import concurrent.futures
import datetime
import hashlib
import html
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SELECTION = [
    ('GAL', 'Galatians', 6, 9, 9, ['perseverance', 'hope']),
    ('JAS', 'James', 1, 2, 4, ['perseverance', 'faith']),
    ('ROM', 'Romans', 12, 12, 12, ['perseverance', 'hope']),
    ('HEB', 'Hebrews', 10, 23, 23, ['perseverance', 'faith']),
    ('2TH', '2 Thessalonians', 3, 13, 13, ['perseverance']),
    ('JHN', 'John', 14, 27, 27, ['peace', 'hope']),
    ('PHP', 'Philippians', 4, 6, 7, ['peace', 'faith']),
    ('ISA', 'Isaiah', 26, 3, 3, ['peace', 'faith']),
    ('MAT', 'Matthew', 11, 28, 30, ['peace', 'hope']),
    ('COL', 'Colossians', 3, 15, 15, ['peace', 'love']),
    ('ROM', 'Romans', 15, 13, 13, ['hope', 'peace']),
    ('ISA', 'Isaiah', 40, 31, 31, ['hope', 'perseverance']),
    ('LAM', 'Lamentations', 3, 22, 23, ['hope', 'faith']),
    ('HEB', 'Hebrews', 11, 1, 1, ['faith', 'hope']),
    ('2CO', '2 Corinthians', 5, 7, 7, ['faith']),
    ('PRO', 'Proverbs', 3, 5, 6, ['faith', 'wisdom']),
    ('MRK', 'Mark', 9, 23, 23, ['faith']),
    ('ROM', 'Romans', 10, 17, 17, ['faith']),
    ('1CO', '1 Corinthians', 13, 4, 7, ['love', 'perseverance']),
    ('JHN', 'John', 13, 34, 35, ['love']),
    ('1JN', '1 John', 4, 19, 19, ['love']),
    ('1CO', '1 Corinthians', 16, 14, 14, ['love']),
    ('EPH', 'Ephesians', 4, 32, 32, ['love', 'peace']),
    ('JAS', 'James', 1, 5, 5, ['wisdom', 'faith']),
    ('PRO', 'Proverbs', 2, 6, 6, ['wisdom']),
    ('JAS', 'James', 3, 17, 17, ['wisdom', 'peace']),
    ('PRO', 'Proverbs', 15, 1, 1, ['wisdom', 'peace']),
    ('COL', 'Colossians', 3, 16, 16, ['wisdom']),
    ('1TH', '1 Thessalonians', 5, 16, 18, ['hope', 'faith']),
    ('PSA', 'Psalms', 119, 11, 11, ['wisdom', 'faith']),
]

def chapter_url(code, chapter):
    digits = 3 if code == 'PSA' else 2
    return f'https://ebible.org/engwebp/{code}{chapter:0{digits}d}.htm'

def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'WordMemo-content-import/1.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        return url, response.read().decode('utf-8')

def clean(fragment):
    fragment = re.split(r'<ul\b|<div class=[\"\']footnote', fragment, maxsplit=1)[0]
    fragment = re.sub(r'<a\b[^>]*>.*?</a>', '', fragment, flags=re.S)
    fragment = re.sub(r'<[^>]*>', ' ', fragment)
    return re.sub(r'\s+', ' ', html.unescape(fragment)).strip()

if __name__ == '__main__':
    urls = sorted({chapter_url(code, chapter) for code, _, chapter, *_ in SELECTION})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        chapters = dict(pool.map(download, urls))
    verses = []
    for code, book, chapter, first, last, tags in SELECTION:
        url = chapter_url(code, chapter)
        parts = re.split(r'<span class="verse" id="V(\d+)">.*?</span>', chapters[url])
        texts = {int(parts[i]): clean(parts[i+1]) for i in range(1, len(parts), 2)}
        selected = [texts[n] for n in range(first, last + 1)]
        assert all(len(t) > 8 and 'Downloads' not in t for t in selected), (book, chapter, first)
        text = ' '.join(selected)
        reference = f'{book} {chapter}:{first}' + (f'–{last}' if last > first else '')
        verses.append(dict(id=f'webp-{code.lower()}-{chapter}-{first}-{last}', book=book,
                           chapter=chapter, startVerse=first, endVerse=last, reference=reference,
                           text=text, translation='WEBP', tags=tags, sourceUrl=f'{url}#V{first}'))
    target = ROOT / 'src' / 'data'
    target.mkdir(parents=True, exist_ok=True)
    content = json.dumps(verses, ensure_ascii=False, indent=2) + '\n'
    (target / 'verses.json').write_text(content, encoding='utf-8')
    manifest = {'translation': 'World English Bible Protestant Edition (WEBP)',
                'copyright': 'Public domain', 'rightsUrl': 'https://ebible.org/engwebp/copyright.htm',
                'retrievedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'sha256': hashlib.sha256(content.encode()).hexdigest(),
                'passageCount': len(verses), 'sourcePages': urls,
                'normalization': 'HTML and footnotes removed; whitespace collapsed; words unchanged.'}
    (target / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Imported {len(verses)} passages from {len(urls)} publisher pages.')
    for v in verses:
        print(v['reference'], '—', v['text'])
