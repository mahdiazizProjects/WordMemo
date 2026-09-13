"""WordMemo authenticated API. Only Cognito access-token subjects own progress.

DynamoDB snapshots use optimistic revisions and atomic chunk replacement.
Group membership is checked on reads and inside every group write transaction.
No passwords, email addresses, access tokens, invite tokens or verse text are logged.
"""
import base64
from datetime import date, datetime, timezone
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import time
import uuid

# The release builder embeds compact catalog metadata here, not Bible text.
CATALOG = None  # CATALOG_DATA_HERE
DB = None
TABLE = os.environ.get('TABLE_NAME', '')
CLIENT = os.environ.get('CLIENT_ID', '')
MAX_RAW = 4_500_000
CHUNK = 300_000


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


def require(condition, message='Invalid request.', status=400):
    if not condition:
        raise Problem(status, message)


def db():
    global DB
    if DB is None:
        import boto3
        DB = boto3.client('dynamodb')
    return DB


def encode(value):
    if isinstance(value, bool): return {'BOOL': value}
    if value is None: return {'NULL': True}
    if isinstance(value, str): return {'S': value}
    if isinstance(value, (int, float)): return {'N': str(value)}
    if isinstance(value, bytes): return {'B': value}
    if isinstance(value, list): return {'L': [encode(v) for v in value]}
    return {'M': {k: encode(v) for k, v in value.items()}}


def decode(value):
    if 'S' in value: return value['S']
    if 'N' in value: return float(value['N']) if '.' in value['N'] else int(value['N'])
    if 'BOOL' in value: return value['BOOL']
    if 'B' in value: return value['B']
    if 'NULL' in value: return None
    if 'L' in value: return [decode(v) for v in value['L']]
    return {k: decode(v) for k, v in value['M'].items()}


def attrs(item): return {k: encode(v) for k, v in item.items()}
def key(pk, sk): return attrs({'PK': pk, 'SK': sk})
def now(): return datetime.now(timezone.utc).isoformat()
def get(pk, sk): return {k: decode(v) for k, v in db().get_item(TableName=TABLE, Key=key(pk, sk), ConsistentRead=True).get('Item', {}).items()}


def query(pk, prefix, limit=250):
    result = db().query(TableName=TABLE, KeyConditionExpression='PK = :pk AND begins_with(SK, :prefix)',
                        ExpressionAttributeValues=attrs({':pk': pk, ':prefix': prefix}), ConsistentRead=True, Limit=limit)
    require(not result.get('LastEvaluatedKey'), 'This collection is too large to open. Please contact the app owner.', 413)
    return [{k: decode(v) for k, v in item.items()} for item in result.get('Items', [])]


def put(pk, sk, item, condition=None, values=None):
    result = {'TableName': TABLE, 'Item': attrs(dict(item, PK=pk, SK=sk))}
    if condition: result['ConditionExpression'] = condition
    if values: result['ExpressionAttributeValues'] = attrs(values)
    return {'Put': result}


def update(pk, sk, expression, values, condition=None):
    result = {'TableName': TABLE, 'Key': key(pk, sk), 'UpdateExpression': expression, 'ExpressionAttributeValues': attrs(values)}
    if condition: result['ConditionExpression'] = condition
    return {'Update': result}


def check(pk, sk, expression='attribute_exists(PK)', values=None):
    result = {'TableName': TABLE, 'Key': key(pk, sk), 'ConditionExpression': expression}
    if values: result['ExpressionAttributeValues'] = attrs(values)
    return {'ConditionCheck': result}


def delete(pk, sk): return {'Delete': {'TableName': TABLE, 'Key': key(pk, sk)}}


def transact(items):
    try: db().transact_write_items(TransactItems=items)
    except Exception as error:
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        if code in ('TransactionCanceledException', 'ConditionalCheckFailedException', 'TransactionConflictException'):
            raise Problem(409, 'Something changed. Refresh and try again.') from None
        raise


def number(value, low, high): return type(value) is int and low <= value <= high

def valid_day(value):
    try: return isinstance(value, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and date.fromisoformat(value).isoformat() == value
    except ValueError: return False


def valid_verse(value, memory=False):
    if not isinstance(value, str): return False
    if value in CATALOG['ranges']: return True
    m = re.fullmatch(r'webp-([a-z0-9]+)-(\d+)-(\d+)-(\d+)', value)
    if not m or (memory and value in CATALOG['notes']): return False
    book, chapter, start, end = m.groups()
    lengths = CATALOG['books'].get(book, [])
    return 1 <= int(chapter) <= len(lengths) and 1 <= int(start) == int(end) <= lengths[int(chapter)-1]


def verse_list(value, max_count=31200, nonempty=False, memory=False):
    return isinstance(value, list) and (not nonempty or len(value) > 0) and len(value) <= max_count and all(valid_verse(v, memory) for v in value) and len(set(value)) == len(value)


def validate_state(x):
    require(isinstance(x, dict) and set(x) <= {'version', 'onboarded', 'settings', 'enrolled', 'favorites', 'progress', 'history', 'goalDays', 'stacks'})
    require(type(x.get('version')) is int and x.get('version') == 1 and type(x.get('onboarded')) is bool and verse_list(x.get('enrolled')) and verse_list(x.get('favorites')))
    s = x.get('settings', {})
    require(isinstance(s, dict) and set(s) <= {'dailyGoal', 'newPerDay', 'mode', 'fontScale', 'reminderTime', 'reminderEnabled', 'celebrationsEnabled'})
    require(number(s.get('dailyGoal'), 1, 30) and number(s.get('newPerDay'), 0, s['dailyGoal']) and s.get('mode') in ('mixed', 'verse', 'reference'))
    require(s.get('fontScale') in (1, 1.15, 1.3) and type(s.get('reminderEnabled')) is bool and isinstance(s.get('reminderTime'), str) and bool(re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', s['reminderTime'])))
    require('celebrationsEnabled' not in s or type(s['celebrationsEnabled']) is bool)
    progress = x.get('progress')
    require(isinstance(progress, dict) and len(progress) <= 62500)
    for k, p in progress.items():
        parts = k.rsplit(':', 1)
        require(len(parts) == 2 and valid_verse(parts[0]) and parts[1] in ('verse', 'reference'))
        require(isinstance(p, dict) and set(p) == {'box', 'due', 'reviews', 'lastReviewed'} and number(p.get('box'), 1, 5) and number(p.get('reviews'), 1, 1000000) and valid_day(p.get('due')) and valid_day(p.get('lastReviewed')) and p['due'] > p['lastReviewed'])
    history = x.get('history')
    require(isinstance(history, list) and len(history) <= 100000)
    ids, days = set(), set()
    for h in history:
        require(isinstance(h, dict) and set(h) == {'id', 'verseId', 'direction', 'day', 'correct', 'newVerse'})
        require(valid_verse(h.get('verseId')) and h.get('direction') in ('verse', 'reference') and valid_day(h.get('day')) and type(h.get('correct')) is bool and type(h.get('newVerse')) is bool)
        require(h.get('id') == h['day'] + ':' + h['verseId'] and h['id'] not in ids)
        ids.add(h['id']); days.add(h['day'])
    goals = x.get('goalDays', [])
    require(isinstance(goals, list) and len(goals) <= 100000 and all(isinstance(d, str) and d in days for d in goals) and len(set(goals)) == len(goals))
    stacks = x.get('stacks', [])
    require(isinstance(stacks, list) and len(stacks) <= 50)
    seen = set()
    for stack in stacks:
        require(isinstance(stack, dict) and set(stack) == {'id', 'name', 'verseIds', 'updatedAt'})
        identifier(stack.get('id')); label(stack.get('name'), 80)
        require(stack['id'] not in seen and verse_list(stack.get('verseIds'), 200, True, True))
        require(isinstance(stack.get('updatedAt'), str) and len(stack['updatedAt']) <= 40)
        try: datetime.fromisoformat(stack['updatedAt'].replace('Z', '+00:00'))
        except ValueError: raise Problem(400, 'Invalid stack date.') from None
        seen.add(stack['id'])
    return x


def progress_read(sub):
    pk = 'USER#' + sub
    head = get(pk, 'head')
    if not head: return {'state': None, 'revision': 0}
    compressed = b''.join(get(pk, f"snapshot#{head['generation']}#{i}")['data'] for i in range(head['chunks']))
    require(hashlib.sha256(compressed).hexdigest() == head['checksum'], 'Saved progress could not be verified. Please retry.', 503)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream: raw = stream.read(MAX_RAW + 1)
    require(len(raw) <= MAX_RAW, 'Saved progress is too large.', 413)
    return {'state': json.loads(raw), 'revision': head['revision'], 'updatedAt': head['updatedAt']}


def summary_for(state):
    correct = [h for h in state['history'] if h['correct']]
    xp = len(correct)*10 + (len(state['history'])-len(correct))*3 + len(state.get('goalDays', []))*25
    return {'verses': len({h['verseId'] for h in correct}), 'practiceDays': len({h['day'] for h in state['history']}), 'xp': xp, 'level': xp//100+1}


def progress_write(sub, body):
    require(set(body) == {'state', 'revision'} and number(body['revision'], 0, 1000000000))
    state = validate_state(body['state'])
    raw = json.dumps(state, separators=(',', ':'), ensure_ascii=False).encode()
    require(len(raw) <= MAX_RAW, 'Progress is too large to sync. Export a backup and contact the app owner.', 413)
    pk, old = 'USER#' + sub, get('USER#' + sub, 'head')
    require(body['revision'] == old.get('revision', 0), 'Progress changed on another device. Please retry.', 409)
    zipped = gzip.compress(raw, mtime=0)
    require(len(zipped) <= 1_800_000, 'Progress is too large to sync. Export a backup and contact the app owner.', 413)
    chunks = [zipped[i:i+CHUNK] for i in range(0, len(zipped), CHUNK)]
    head = {'generation': uuid.uuid4().hex, 'revision': body['revision'] + 1, 'chunks': len(chunks), 'checksum': hashlib.sha256(zipped).hexdigest(), 'updatedAt': now()}
    items = [put(pk, 'head', head, 'revision = :r' if old else 'attribute_not_exists(PK)', {':r': body['revision']} if old else None), put(pk, 'summary', dict(summary_for(state), updatedAt=head['updatedAt']))]
    items += [put(pk, f"snapshot#{head['generation']}#{i}", {'data': data}) for i, data in enumerate(chunks)]
    # Only retired generations expire. The currently committed copy has no TTL.
    items += [update(pk, f"snapshot#{old['generation']}#{i}", 'SET expiresAt = :ttl', {':ttl': int(time.time())+7*86400}) for i in range(old.get('chunks', 0))]
    transact(items)
    return {'state': None, 'revision': head['revision'], 'updatedAt': head['updatedAt']}


def identifier(value):
    require(isinstance(value, str) and bool(re.fullmatch(r'[a-zA-Z0-9_-]{8,80}', value)))
    return value


def label(value, maximum):
    require(isinstance(value, str) and 0 < len(value.strip()) <= maximum and not any(ord(c) < 32 for c in value), 'Please enter a short name without line breaks.')
    return value.strip()


def member(sub, gid, owner=False):
    identifier(gid)
    meta, me = get('GROUP#'+gid, 'meta'), get('GROUP#'+gid, 'member#'+sub)
    require(bool(meta) and not meta.get('closed') and bool(me), 'This group is unavailable or you are not a member.', 403)
    if owner: require(meta['owner'] == sub, 'Only the group owner can do that.', 403)
    return meta, me


def guard(sub, gid):
    return [check('GROUP#'+gid, 'meta', 'closed = :no', {':no': False}), check('GROUP#'+gid, 'member#'+sub)]


def groups_list(sub):
    groups = []
    for link in query('USER#'+sub, 'group#', 25):
        gid = link['groupId']
        meta, me = get('GROUP#'+gid, 'meta'), get('GROUP#'+gid, 'member#'+sub)
        if meta and not meta.get('closed') and me: groups.append({'id': gid, 'name': meta['name'], 'members': meta['memberCount'], 'owner': meta['owner'] == sub})
    return {'groups': groups}


def groups_create(sub, body):
    gid, name, display = identifier(body.get('id')), label(body.get('name'), 80), label(body.get('displayName'), 40)
    existing = get('GROUP#'+gid, 'meta')
    if existing:
        require(existing['owner'] == sub, 'Group identifier already used.', 409)
        return {'id': gid}
    transact([put('GROUP#'+gid, 'meta', {'id': gid, 'name': name, 'owner': sub, 'closed': False, 'memberCount': 1, 'stackCount': 0, 'inviteHash': '', 'createdAt': now()}, 'attribute_not_exists(PK)'),
              put('GROUP#'+gid, 'member#'+sub, {'userId': sub, 'displayName': display, 'role': 'owner', 'shareProgress': False}),
              put('USER#'+sub, 'group#'+gid, {'groupId': gid}),
              update('USER#'+sub, 'groups', 'ADD groupCount :one', {':one': 1, ':max': 20}, 'attribute_not_exists(groupCount) OR groupCount < :max')])
    return {'id': gid}


def group_read(sub, gid):
    meta, me = member(sub, gid)
    members = []
    for m in query('GROUP#'+gid, 'member#', 55):
        info = {k: m[k] for k in ('userId', 'displayName', 'role', 'shareProgress')}
        if m['shareProgress']:
            s = get('USER#'+m['userId'], 'summary')
            info['summary'] = {k: s.get(k, 0) for k in ('verses', 'practiceDays', 'xp', 'level')}
        members.append(info)
    stacks = [{k: s[k] for k in ('id', 'name', 'verseIds', 'authorId', 'createdAt')} for s in query('GROUP#'+gid, 'stack#', 55)]
    # Recheck after reads so a completed leave/opt-out is reflected immediately.
    member(sub, gid)
    for info in members:
        current = get('GROUP#'+gid, 'member#'+info['userId'])
        if not current.get('shareProgress'): info.pop('summary', None); info['shareProgress'] = False
    members = [m for m in members if get('GROUP#'+gid, 'member#'+m['userId'])]
    return {'id': gid, 'name': meta['name'], 'ownerId': meta['owner'], 'me': {k: me[k] for k in ('userId', 'displayName', 'role', 'shareProgress')}, 'members': members, 'stacks': stacks, 'roomId': meta.get('roomId')}


def invite_create(sub, gid):
    meta, _ = member(sub, gid, True)
    token, expires = secrets.token_urlsafe(24), int(time.time())+7*86400
    digest = hashlib.sha256(token.encode()).hexdigest()
    transact([check('GROUP#'+gid, 'member#'+sub),
              update('GROUP#'+gid, 'meta', 'SET inviteHash = :hash', {':hash': digest, ':no': False}, 'closed = :no'),
              put('INVITE#'+digest, 'meta', {'groupId': gid, 'expiresAt': expires})])
    return {'token': token, 'expiresAt': expires}


def invite_join(sub, body):
    token, display = body.get('token'), label(body.get('displayName'), 40)
    require(isinstance(token, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{24,80}', token)), 'This invitation is invalid.')
    digest = hashlib.sha256(token.encode()).hexdigest()
    invite = get('INVITE#'+digest, 'meta')
    require(bool(invite) and invite['expiresAt'] > time.time(), 'This invitation has expired. Ask the group owner for a new link.', 403)
    gid, pk = invite['groupId'], 'GROUP#'+invite['groupId']
    meta = get(pk, 'meta')
    require(meta and not meta['closed'] and meta['inviteHash'] == digest, 'This invitation has expired. Ask the group owner for a new link.', 403)
    if get(pk, 'member#'+sub): return {'id': gid}
    transact([update(pk, 'meta', 'ADD memberCount :one', {':one': 1, ':max': 50, ':hash': digest, ':no': False}, 'memberCount < :max AND inviteHash = :hash AND closed = :no'),
              put(pk, 'member#'+sub, {'userId': sub, 'displayName': display, 'role': 'member', 'shareProgress': False}, 'attribute_not_exists(PK)'),
              put('USER#'+sub, 'group#'+gid, {'groupId': gid}),
              update('USER#'+sub, 'groups', 'ADD groupCount :one', {':one': 1, ':max': 20}, 'attribute_not_exists(groupCount) OR groupCount < :max')])
    return {'id': gid}


def membership_update(sub, gid, body):
    _, me = member(sub, gid)
    require(set(body) == {'displayName', 'shareProgress'} and type(body['shareProgress']) is bool)
    me = {k: me[k] for k in ('userId', 'role')}
    me.update(displayName=label(body['displayName'], 40), shareProgress=body['shareProgress'])
    transact([check('GROUP#'+gid, 'meta', 'closed = :no', {':no': False}), put('GROUP#'+gid, 'member#'+sub, me, 'attribute_exists(PK)')])
    return {'ok': True}


def member_remove(sub, gid, target):
    meta, _ = member(sub, gid)
    require(target != meta['owner'], 'The owner can close the group instead of leaving.', 400)
    require(target == sub or meta['owner'] == sub, 'Only the owner can remove another member.', 403)
    if not get('GROUP#'+gid, 'member#'+target): return {'ok': True}
    items = [update('GROUP#'+gid, 'meta', 'ADD memberCount :minus', {':minus': -1, ':no': False}, 'closed = :no'),
             {'Delete': {'TableName': TABLE, 'Key': key('GROUP#'+gid, 'member#'+target), 'ConditionExpression': 'attribute_exists(PK)'}},
             delete('USER#'+target, 'group#'+gid), update('USER#'+target, 'groups', 'ADD groupCount :minus', {':minus': -1})]
    if target != sub: items.append(check('GROUP#'+gid, 'member#'+sub))
    transact(items)
    return {'ok': True}


def group_close(sub, gid):
    meta, _ = member(sub, gid, True)
    # Soft close is immediate and revokes all reads and writes. Retain shared
    # content for recovery, then remove each user's active group index.
    transact([check('GROUP#'+gid, 'member#'+sub), update('GROUP#'+gid, 'meta', 'SET closed = :yes, inviteHash = :empty', {':yes': True, ':empty': ''})])
    for m in query('GROUP#'+gid, 'member#', 55):
        try:
            transact([{'Delete': {'TableName': TABLE, 'Key': key('USER#'+m['userId'], 'group#'+gid), 'ConditionExpression': 'attribute_exists(PK)'}}, update('USER#'+m['userId'], 'groups', 'ADD groupCount :minus', {':minus': -1})])
        except Problem: pass
    return {'ok': True}


def stack_share(sub, gid, body):
    member(sub, gid)
    sid, name = identifier(body.get('id')), label(body.get('name'), 80)
    require(verse_list(body.get('verseIds'), 200, True, True), 'Choose between 1 and 200 verse cards.')
    existing = get('GROUP#'+gid, 'stack#'+sid)
    if existing:
        require(existing['authorId'] == sub, 'Stack identifier already used.', 409)
        return {'id': sid}
    transact([check('GROUP#'+gid, 'member#'+sub),
              update('GROUP#'+gid, 'meta', 'ADD stackCount :one', {':one': 1, ':max': 50, ':no': False}, 'stackCount < :max AND closed = :no'),
              put('GROUP#'+gid, 'stack#'+sid, {'id': sid, 'name': name, 'verseIds': body['verseIds'], 'authorId': sub, 'createdAt': now()}, 'attribute_not_exists(PK)')])
    return {'id': sid}


def stack_remove(sub, gid, sid):
    meta, _ = member(sub, gid)
    stack = get('GROUP#'+gid, 'stack#'+sid)
    if not stack: return {'ok': True}
    require(sub in (stack['authorId'], meta['owner']), 'Only the author or group owner can remove this stack.', 403)
    transact([check('GROUP#'+gid, 'member#'+sub), update('GROUP#'+gid, 'meta', 'ADD stackCount :minus', {':minus': -1, ':no': False}, 'closed = :no'),
              {'Delete': {'TableName': TABLE, 'Key': key('GROUP#'+gid, 'stack#'+sid), 'ConditionExpression': 'attribute_exists(PK)'}}])
    return {'ok': True}


def room_create(sub, gid, body):
    meta, _ = member(sub, gid)
    rid, sid = identifier(body.get('id')), identifier(body.get('stackId'))
    existing = get('GROUP#'+gid, 'room#'+rid)
    if existing:
        require(existing['hostId'] == sub, 'Room identifier already used.', 409)
        return {'id': rid}
    stack = get('GROUP#'+gid, 'stack#'+sid)
    require(bool(stack), 'Choose a shared stack first.', 404)
    require(body.get('direction') in ('verse', 'reference'))
    old = get('GROUP#'+gid, 'room#'+meta.get('roomId', ''))
    require(not old or old['ended'] or old['expiresAt'] <= time.time(), 'A practice room is already open in this group.', 409)
    room = {'id': rid, 'hostId': sub, 'name': stack['name'], 'verseIds': stack['verseIds'][:30], 'direction': body['direction'], 'index': 0, 'revealed': False, 'ended': False, 'revision': 1, 'expiresAt': int(time.time())+6*3600}
    condition = 'closed = :no AND roomId = :old' if meta.get('roomId') else 'closed = :no AND attribute_not_exists(roomId)'
    values = {':new': rid, ':no': False}
    if meta.get('roomId'): values[':old'] = meta['roomId']
    transact([check('GROUP#'+gid, 'member#'+sub), check('GROUP#'+gid, 'stack#'+sid), update('GROUP#'+gid, 'meta', 'SET roomId = :new', values, condition), put('GROUP#'+gid, 'room#'+rid, room, 'attribute_not_exists(PK)')])
    return {'id': rid}


def room_read(sub, gid, rid):
    member(sub, gid)
    room = get('GROUP#'+gid, 'room#'+identifier(rid))
    require(room and room['expiresAt'] > time.time(), 'This practice room has ended or expired.', 404)
    room = {k: v for k, v in room.items() if k not in ('PK', 'SK')}
    responses = query('GROUP#'+gid, f'answer#{rid}#{room["index"]}#', 55)
    # Show collective participation, never identify who missed an answer.
    active = [r for r in responses if get('GROUP#'+gid, 'member#'+r['userId'])]
    mine = next((r for r in active if r['userId'] == sub), None)
    room['responses'] = len(active)
    room['remembered'] = sum(r['correct'] for r in active) if room['revealed'] else 0
    room['myAnswer'] = mine['correct'] if mine else None
    member(sub, gid)
    return room


def room_advance(sub, gid, rid, body):
    meta, _ = member(sub, gid)
    room = get('GROUP#'+gid, 'room#'+rid)
    require(room and room['expiresAt'] > time.time(), 'This room has expired.', 404)
    require(room['hostId'] == sub or (body.get('action') == 'end' and meta['owner'] == sub), 'Only the host can reveal or advance cards.', 403)
    require(not room['ended'] and body.get('revision') == room['revision'], 'The room changed. Refresh to continue.', 409)
    action = body.get('action')
    require(action in ('reveal', 'next', 'end'))
    require(action != 'next' or room['revealed'], 'Reveal the answer before the next card.')
    previous = room['revision']
    room = {k: v for k, v in room.items() if k not in ('PK', 'SK')}
    if action == 'reveal': room['revealed'] = True
    elif action == 'end': room['ended'] = True
    else:
        room['index'] += 1; room['revealed'] = False
        if room['index'] >= len(room['verseIds']): room['ended'] = True
    room['revision'] += 1
    transact(guard(sub, gid) + [put('GROUP#'+gid, 'room#'+rid, room, 'revision = :r', {':r': previous})])
    return {'ok': True}


def room_answer(sub, gid, rid, body):
    member(sub, gid)
    require(type(body.get('correct')) is bool and number(body.get('index'), 0, 29))
    room = get('GROUP#'+gid, 'room#'+rid)
    require(room and room['expiresAt'] > time.time() and not room['ended'] and room['revealed'] and body['index'] == room['index'], 'The host has moved on. Continue with the current card.', 409)
    sk = f'answer#{rid}#{room["index"]}#{sub}'
    existing = get('GROUP#'+gid, sk)
    if existing: return {'ok': True, 'correct': existing['correct']}
    transact(guard(sub, gid) + [check('GROUP#'+gid, 'room#'+rid, 'revision = :r AND expiresAt > :now', {':r': room['revision'], ':now': int(time.time())}),
              put('GROUP#'+gid, sk, {'userId': sub, 'correct': body['correct'], 'expiresAt': room['expiresAt']+86400}, 'attribute_not_exists(PK)')])
    return {'ok': True, 'correct': body['correct']}


def route(sub, method, path, body):
    if path == '/progress':
        if method == 'GET': return progress_read(sub)
        if method == 'PUT': return progress_write(sub, body)
    if path == '/groups':
        if method == 'GET': return groups_list(sub)
        if method == 'POST': return groups_create(sub, body)
    if path == '/groups/join' and method == 'POST': return invite_join(sub, body)
    parts = path.strip('/').split('/')
    if len(parts) >= 2 and parts[0] == 'groups':
        gid = identifier(parts[1])
        tail = parts[2:]
        if not tail and method == 'GET': return group_read(sub, gid)
        if not tail and method == 'DELETE': return group_close(sub, gid)
        if tail == ['invite'] and method == 'POST': return invite_create(sub, gid)
        if tail == ['membership'] and method == 'PUT': return membership_update(sub, gid, body)
        if len(tail) == 2 and tail[0] == 'members' and method == 'DELETE': return member_remove(sub, gid, identifier(tail[1]))
        if tail == ['stacks'] and method == 'POST': return stack_share(sub, gid, body)
        if len(tail) == 2 and tail[0] == 'stacks' and method == 'DELETE': return stack_remove(sub, gid, identifier(tail[1]))
        if tail == ['rooms'] and method == 'POST': return room_create(sub, gid, body)
        if len(tail) >= 2 and tail[0] == 'rooms':
            rid = identifier(tail[1])
            if len(tail) == 2 and method == 'GET': return room_read(sub, gid, rid)
            if len(tail) == 2 and method == 'PUT': return room_advance(sub, gid, rid, body)
            if len(tail) == 3 and tail[2] == 'answer' and method == 'POST': return room_answer(sub, gid, rid, body)
    raise Problem(404, 'That page could not be found.')


def handler(event, context):
    status = 200
    try:
        method = event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('rawPath', '')
        if method == 'GET' and path == '/health': result = {'ok': True, 'version': 2}
        else:
            claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
            require(claims.get('token_use') == 'access' and claims.get('client_id') == CLIENT and isinstance(claims.get('sub'), str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{8,80}', claims['sub'])), 'Sign in to continue.', 401)
            raw = event.get('body') or '{}'
            if event.get('isBase64Encoded'): raw = base64.b64decode(raw).decode()
            require(len(raw.encode()) <= MAX_RAW + 100, 'Request is too large. Export a backup and contact the app owner.', 413)
            body = json.loads(raw)
            require(isinstance(body, dict))
            result = route(claims['sub'], method, path, body)
    except Problem as error: status, result = error.status, {'message': error.message}
    except (ValueError, TypeError, KeyError, UnicodeError): status, result = 400, {'message': 'The request was invalid. Please refresh and try again.'}
    except Exception:
        # Log only an incident identifier, never the event or exception contents.
        print('WordMemo API failure', getattr(context, 'aws_request_id', 'unknown'))
        status, result = 503, {'message': 'Saving is temporarily unavailable. Your changes are queued; please retry.'}
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}, 'body': json.dumps(result, separators=(',', ':'), ensure_ascii=False)}
