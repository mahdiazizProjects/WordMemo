"""Import the complete WEBP from eBible.org's verse-per-line archive.

Two publisher formats are checked for identical book/chapter/verse coverage.
Text comes directly from the verse-per-line text, never generated. Compact rows
keep the mobile bundle small. Run from the project root; only Python 3 required.
"""
import argparse
import collections
import datetime
import hashlib
import html
import json
import pathlib
import re
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://ebible.org/Scriptures/'
VPL_CODES = {'SOL':'SNG','EZE':'EZK','JOE':'JOL','NAH':'NAM','MAR':'MRK','JOH':'JHN','PHI':'PHP','JAM':'JAS','1JO':'1JN','2JO':'2JN','3JO':'3JN'}
SECTION_NAMES = ['Law & beginnings','History','Poetry & wisdom','Prophets','Gospels','Acts & early church','Letters','Revelation']

def download(cache, name):
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(BASE + name, timeout=90) as response:
            path.write_bytes(response.read())
    return path

def section(order):
    if order <= 5: return SECTION_NAMES[0]
    if order <= 17: return SECTION_NAMES[1]
    if order <= 22: return SECTION_NAMES[2]
    if order <= 39: return SECTION_NAMES[3]
    if order <= 43: return SECTION_NAMES[4]
    if order == 44: return SECTION_NAMES[5]
    if order <= 65: return SECTION_NAMES[6]
    return SECTION_NAMES[7]

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=str(ROOT.parent / 'corpus-cache'))
    args = ap.parse_args()
    cache = pathlib.Path(args.cache); cache.mkdir(parents=True, exist_ok=True)
    vplpath = download(cache, 'engwebp_vpl.zip')
    htmlpath = download(cache, 'engwebp_html.zip')
    archive = zipfile.ZipFile(htmlpath)
    index = archive.read('index.htm').decode('utf-8-sig')
    matches = re.findall(r"<a class='(?:oo|nn)' href='([A-Z0-9]{3})\d+\.htm'>([^<]+)</a>", index)
    assert len(matches) == 66, f'Expected this edition’s 66 books; found {len(matches)}'
    books = [dict(id=code, name=html.unescape(name), order=i+1,
                  testament='Old Testament' if i < 39 else 'New Testament', section=section(i+1),
                  aliases=list(dict.fromkeys([code, name, *[k for k,v in VPL_CODES.items() if v==code]]))) for i,(code,name) in enumerate(matches)]
    by_code = {b['id']: i for i,b in enumerate(books)}
    htmlrefs = set(); introductions = {}
    for name in archive.namelist():
        m = re.fullmatch(r'([A-Z0-9]{3})(\d{2,3})\.htm', name)
        if not m or m[1] not in by_code or int(m[2]) == 0: continue
        code, chapter = m[1], int(m[2]); text = archive.read(name).decode('utf-8-sig')
        for v in re.findall(r'<span class="verse" id="V(\d+)">', text): htmlrefs.add((by_code[code],chapter,int(v)))
        intro = re.findall(r"<div class='d'>(.*?)</div>",text,re.S)
        if intro: introductions[f'{code}:{chapter}'] = ' '.join(re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>','',i))).strip() for i in intro)
    vplarchive = zipfile.ZipFile(vplpath)
    rows = []; refs = set(); text_notes = {}
    for line in vplarchive.read('engwebp_vpl.txt').decode('utf-8-sig').splitlines():
        m = re.fullmatch(r'(\w{3}) (\d+):(\d+) (.*)',line)
        assert m, 'Unrecognized source line; aborting rather than dropping it.'
        code,chapter,verse,text=m.groups(); code=VPL_CODES.get(code,code)
        key=(by_code[code],int(chapter),int(verse))
        assert key not in refs and key[1]>0 and key[2]>0
        refs.add(key); rows.append([*key,text])
        if not text:
            filename=f'{code}{int(chapter):0{3 if code=="PSA" else 2}d}.htm'
            page=archive.read(filename).decode('utf-8-sig')
            segment=re.search(r'<span class="verse" id="V'+verse+r'">.*?</span>(.*?)(?=<span class="verse"|<ul class=)',page,re.S)
            notes=re.findall(r'<span class="popup">(.*?)</span>',segment[1],re.S) if segment else []
            assert notes, ('Empty reference without a publisher note',code,chapter,verse)
            text_notes[f'webp-{code.lower()}-{chapter}-{verse}-{verse}']=' '.join(html.unescape(re.sub(r'<[^>]+>','',n)).strip() for n in notes)
    assert refs==htmlrefs, f'Publisher formats disagree on {len(refs ^ htmlrefs)} verse references.'
    rows.sort(key=lambda r:r[:3]); chapter_refs={(r[0],r[1]) for r in rows}
    assert len(chapter_refs)==1189, f'Unexpected chapter count: {len(chapter_refs)}'
    for i,b in enumerate(books):
        br=[r for r in rows if r[0]==i]
        chapters=sorted({r[1] for r in br}); assert chapters==list(range(1,max(chapters)+1))
        b['chapters']=len(chapters); b['verseCount']=len(br)
        b['chapterLengths']=[sum(r[1]==c for r in br) for c in chapters]
        for c in chapters:
            vs=[r[2] for r in br if r[1]==c]
            assert vs==list(range(1,max(vs)+1)), (b['id'],c,'gapped source numbering')
    out=ROOT/'src'/'data'; out.mkdir(exist_ok=True)
    encoded=json.dumps(rows,ensure_ascii=False,separators=(',',':'))+'\n'
    (out/'bible.json').write_text(encoded,encoding='utf-8')
    (out/'books.json').write_text(json.dumps(books,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'chapter-introductions.json').write_text(json.dumps(introductions,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'verse-notes.json').write_text(json.dumps(text_notes,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    manifest={
      'edition':'World English Bible Protestant Edition (WEBP)', 'canon':'66-book Old and New Testaments',
      'source':'https://ebible.org/engwebp/', 'rightsUrl':'https://ebible.org/engwebp/copyright.htm',
      'copyright':'Public domain', 'retrievedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'books':len(books),'chapters':len(chapter_refs),'verses':len(rows),
      'versesWithMainText':sum(bool(r[3]) for r in rows),'noteOnlyReferences':len(text_notes),
      'bibleSha256':hashlib.sha256(encoded.encode()).hexdigest(),
      'sourceArchives':[{'url':BASE+p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [vplpath,htmlpath]],
      'coverageCheck':'Every verse reference independently matched between the publisher’s VPL and HTML formats.',
      'textPolicy':'Verse text copied from VPL without word, punctuation, or capitalization changes. Footnotes and layout are outside verse text. Psalm superscriptions retained separately.',
      'rowFormat':['bookIndex','chapter','verse','text'],
      'countNote':'Verse totals are edition-specific. Preserve source numbering rather than imposing another edition’s total.'
    }
    (out/'bible-provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'books':len(books),'chapters':len(chapter_refs),'verses':len(rows),'textBytes':len(encoded.encode()),'sourceCoverageMatched':True}))
