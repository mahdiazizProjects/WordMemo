"""Reproducible topical curation, lexical suggestions, and keyword extraction.

All verses receive structural metadata through their book. Devotional tags are
never forced on unrelated verses. Curated ranges reflect editorial selection;
keyword suggestions reflect occurrence, not an asserted teaching or endorsement.
"""
import collections
import hashlib
import json
import math
import pathlib
import re

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'src'/'data'
STOP=set('a an the and or but nor for so yet if then than that this these those of to in on at by from into unto upon with without as is are was were be been being have has had do does did i me my mine we us our ours you your yours he him his she her hers it its they them their theirs who whom whose which what when where why how all any each every both either neither some such no not only also very even just will would shall should can could may might must let lest now again about above after against among before behind below between beyond down during except far few first further here herself himself itself less many more most much near once other out over own same still there themselves through too under until up well while within yourself yourselves said says say saying came come comes went go goes going man men one two three son sons daughter daughters father fathers mother mothers brother brothers sister sisters king kings people children house houses day days year years time times thing things behold pass called name names place places made make take took give gave done hand hands answered spoke speak told therefore because according around back brought set put found saw see seen heard hear unto thou thee thy thine ye hath shalt doth thou art o oh yes lo am thee saith thereof therein thence whence away forth hundred thousand cubits cubit shekels shekel before them him her his himselve'.split())
TOKENS=re.compile(r"[a-z]+(?:['’][a-z]+)?")

if __name__=='__main__':
    rows=json.loads((DATA/'bible.json').read_text()); books=json.loads((DATA/'books.json').read_text())
    topics=json.loads((ROOT/'content'/'topics.json').read_text())
    assert len({t['id'] for t in topics})==len(topics)
    lookup={(books[r[0]]['id'],r[1],r[2]):i for i,r in enumerate(rows)}
    curated=[set() for _ in rows]; curated_sources=collections.defaultdict(dict)
    for ti,t in enumerate(topics):
        for reference in t['references']:
            m=re.fullmatch(r'([A-Z0-9]{3}) (\d+):(\d+)(?:-(\d+))?',reference); assert m,reference
            code,c,start,end=m.groups(); c=int(c); start=int(start); end=int(end or start)
            for v in range(start,end+1):
                key=(code,c,v); assert key in lookup, ('Unknown curated reference',reference,key)
                i=lookup[key]
                if not rows[i][3]: continue
                curated[i].add(ti); curated_sources[t['id']][str(i)]=reference
    compiled=[re.compile(r'\b(?:'+('|'.join(t['patterns']))+r')\b',re.I) for t in topics]
    tokens=[]; df=collections.Counter()
    for row in rows:
        words=[w.replace('’',"'").removesuffix("'s") for w in TOKENS.findall(row[3].lower())]
        words=[w for w in words if len(w)>2 and w not in STOP]
        tokens.append(words); df.update(set(words))
    annotations=[]; topiccounts=[{'curated':0,'suggested':0} for _ in topics]
    for i,row in enumerate(rows):
        suggestions=[ti for ti,p in enumerate(compiled) if ti not in curated[i] and p.search(row[3])]
        counts=collections.Counter(tokens[i])
        keywords=sorted(counts,key=lambda w:(-(1+math.log(counts[w]))*math.log(1+len(rows)/(1+df[w])),w))[:6]
        annotations.append([sorted(curated[i]),suggestions,keywords])
        for ti in curated[i]: topiccounts[ti]['curated']+=1
        for ti in suggestions: topiccounts[ti]['suggested']+=1
    publictopics=[{k:v for k,v in t.items() if k not in ['references','patterns']} | {'counts':topiccounts[i]} for i,t in enumerate(topics)]
    encoded=json.dumps(annotations,ensure_ascii=False,separators=(',',':'))+'\n'
    (DATA/'annotations.json').write_text(encoded,encoding='utf-8')
    (DATA/'topics.json').write_text(json.dumps(publictopics,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (DATA/'curated-sources.json').write_text(json.dumps(curated_sources,separators=(',',':'))+'\n')
    report={'topics':len(topics),'allReferences':len(rows),'structuralCoverage':len(rows),
      'curatedVerses':sum(bool(a[0]) for a in annotations),'versesWithKeywordSuggestions':sum(bool(a[1]) for a in annotations),
      'versesWithAnyTopic':sum(bool(a[0] or a[1]) for a in annotations),
      'structuralOnlyVerses':sum(not (a[0] or a[1]) for a in annotations),
      'curatedPassageSelections':sum(len(t['references']) for t in topics),
      'keywordVocabulary':len(df),'annotationSha256':hashlib.sha256(encoded.encode()).hexdigest(),
      'taxonomySha256':hashlib.sha256((ROOT/'content'/'topics.json').read_bytes()).hexdigest(),
      'annotationRowFormat':['curatedTopicIndexes','suggestedTopicIndexes','keywords'],
      'method':'Editorial passage selections plus whole-word/phrase rules. TF-IDF keywords are extracted from each verse. No text or theological interpretation is generated at runtime.',
      'limitations':['Curated means editorial selection, not independent theological review.','Keyword suggestions describe matching vocabulary; they can include negative examples or another speaker’s words.','Book-level literary sections are navigation aids; a book can contain multiple genres.','Structural-only verses remain fully searchable and available for practice.'],
      'topicCounts':{t['id']:topiccounts[i] for i,t in enumerate(topics)}}
    (DATA/'classification-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['topicCounts','method','limitations','annotationRowFormat']}))
