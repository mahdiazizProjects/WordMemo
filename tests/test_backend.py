"""API/security integration against Moto's DynamoDB transaction implementation."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import boto3
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('backend', ROOT/'backend/handler.py')
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
api.CATALOG = {'books':{b['id'].lower(): b['chapterLengths'] for b in json.loads((ROOT/'src/data/books.json').read_text())}, 'ranges':[v['id'] for v in json.loads((ROOT/'src/data/verses.json').read_text())], 'notes':list(json.loads((ROOT/'src/data/verse-notes.json').read_text()))}
A, B, C = 'alice-123456', 'bob-12345678', 'outsider-1234'
G, S, R = 'group-123456', 'stack-123456', 'room-12345678'
VERSE = 'webp-psa-119-11-11'


def state():
    return {'version':1,'onboarded':True,'settings':{'dailyGoal':5,'newPerDay':5,'mode':'mixed','fontScale':1,'reminderTime':'08:00','reminderEnabled':False},'enrolled':[VERSE],'favorites':[], 'history':[], 'progress':{}, 'goalDays':[], 'stacks':[]}


@mock_aws
class BackendTests(unittest.TestCase):
    def test_preflight_is_empty_and_group_data_still_requires_auth(self):
        response = api.handler({'rawPath': '/groups/' + G, 'requestContext': {'http': {'method': 'OPTIONS'}}}, None)
        self.assertEqual(response['statusCode'], 204)
        self.assertEqual(response['body'], '')
        self.call('GET', '/groups/' + G, claims={}, status=401)

    def setUp(self):
        api.TABLE, api.CLIENT = 'WordMemoTest', 'client-123456'
        api.DB = boto3.client('dynamodb', region_name='us-west-2')
        api.DB.create_table(TableName=api.TABLE, BillingMode='PAY_PER_REQUEST', AttributeDefinitions=[{'AttributeName':k,'AttributeType':'S'} for k in ('PK','SK')], KeySchema=[{'AttributeName':'PK','KeyType':'HASH'},{'AttributeName':'SK','KeyType':'RANGE'}])
    def call(self, method, path, body=None, who=A, status=200, claims=None):
        claims = claims if claims is not None else {'sub':who,'token_use':'access','client_id':api.CLIENT}
        response = api.handler({'rawPath':path,'body':json.dumps(body or {}),'requestContext':{'http':{'method':method},'authorizer':{'jwt':{'claims':claims}}}}, None)
        self.assertEqual(response['statusCode'],status,response)
        self.assertEqual(response['headers']['Cache-Control'],'no-store')
        return json.loads(response['body'])
    def group(self):
        self.call('POST','/groups',{'id':G,'name':'Test group','displayName':'Alice'})
        invitation = self.call('POST',f'/groups/{G}/invite')
        self.call('POST','/groups/join',{'token':invitation['token'],'displayName':'Bob'},who=B)
        return invitation
    def room(self):
        self.group(); self.call('POST',f'/groups/{G}/stacks',{'id':S,'name':'Peace','verseIds':[VERSE,'webp-jhn-3-16-16']})
        self.call('POST',f'/groups/{G}/rooms',{'id':R,'stackId':S,'direction':'reference'})

    def test_missing_wrong_client_and_id_tokens_are_rejected_before_storage(self):
        for claims in ({},{'sub':A,'client_id':'other','token_use':'access'},{'sub':A,'client_id':api.CLIENT,'token_use':'id'}):
            with patch.object(api,'db') as db:
                self.call('GET','/progress',claims=claims,status=401); db.assert_not_called()
    def test_private_progress_revisions_and_no_client_selected_user(self):
        first=self.call('PUT','/progress',{'state':state(),'revision':0}); self.assertEqual(first['revision'],1)
        self.assertEqual(self.call('GET','/progress')['state'],state())
        self.assertIsNone(self.call('GET','/progress',who=B)['state'])
        self.call('PUT','/progress',{'state':state(),'revision':0},status=409)
        self.call('PUT','/progress',{'state':state(),'revision':1,'userId':B},status=400)
        self.assertEqual(self.call('GET','/progress')['revision'],1)
    def test_lessons_and_drafts_survive_old_clients_and_reject_corruption(self):
        value = state()
        lesson = {'id': S + ':0', 'stackId': S, 'name': 'Hope', 'verseIds': [VERSE], 'unit': 0, 'step': 0, 'mistakes': [], 'result': None, 'input': 'Unfinished', 'tiles': [], 'hinted': False, 'correct': 0, 'updatedAt': '2026-09-14T12:00:00Z'}
        value['lessons'] = [lesson]
        value['stackDraft'] = {'value': {'id': S, 'name': '', 'verseIds': [], 'updatedAt': lesson['updatedAt']}, 'updatedAt': lesson['updatedAt']}
        self.call('PUT', '/progress', {'state': value, 'revision': 0})
        self.assertEqual(self.call('GET', '/progress')['state'], value)
        self.call('PUT', '/progress', {'state': state(), 'revision': 1})
        self.assertEqual(self.call('GET', '/progress')['state'], value)
        for patch in ({'step': 9}, {'tiles': [0, 0]}, {'extra': 'bad'}, {'verseIds': ['bad']}, {'correct': 9}):
            bad = copy.deepcopy(value); bad['lessons'][0].update(patch)
            self.call('PUT', '/progress', {'state': bad, 'revision': 2}, status=400)
        value['stackDraft']['value'] = None
        self.call('PUT', '/progress', {'state': value, 'revision': 2})
        self.assertIsNone(self.call('GET', '/progress')['state']['stackDraft']['value'])

    def test_chunk_replacement_retires_only_previous_snapshot(self):
        with patch.object(api,'CHUNK',100):
            self.call('PUT','/progress',{'state':state(),'revision':0})
            old=api.get('USER#'+A,'head'); self.assertGreater(old['chunks'],1)
            changed=state();changed['settings']['dailyGoal']=6
            self.call('PUT','/progress',{'state':changed,'revision':1})
            new=api.get('USER#'+A,'head')
            for i in range(old['chunks']): self.assertIn('expiresAt',api.get('USER#'+A,f"snapshot#{old['generation']}#{i}"))
            for i in range(new['chunks']): self.assertNotIn('expiresAt',api.get('USER#'+A,f"snapshot#{new['generation']}#{i}"))
            self.assertEqual(self.call('GET','/progress')['state'],changed)
    def test_invalid_verse_text_injection_duplicate_history_and_oversize_rejected(self):
        x=state();x['enrolled']=['webp-gen-1-999-999']; self.call('PUT','/progress',{'state':x,'revision':0},status=400)
        x=state();x['verseText']='injected';self.call('PUT','/progress',{'state':x,'revision':0},status=400)
        x=state();x['stacks']=[{'id':'stack-123456','name':'Note only','verseIds':['webp-act-8-37-37'],'updatedAt':'2026-09-12T00:00:00Z'}]; self.call('PUT','/progress',{'state':x,'revision':0},status=400)
        h={'id':'2026-09-12:'+VERSE,'verseId':VERSE,'direction':'verse','day':'2026-09-12','correct':True,'newVerse':True}
        x=state();x['history']=[h,h];self.call('PUT','/progress',{'state':x,'revision':0},status=400)
        with patch.object(api,'MAX_RAW',10): self.call('PUT','/progress',{'state':state(),'revision':0},status=413)
        self.assertIsNone(self.call('GET','/progress')['state'])
    def test_group_membership_invite_rotation_and_expiry(self):
        invitation=self.group()
        self.call('GET',f'/groups/{G}',who=C,status=403)
        self.call('POST',f'/groups/{G}/invite',who=B,status=403)
        self.call('POST',f'/groups/{G}/invite')
        self.call('POST','/groups/join',{'token':invitation['token'],'displayName':'C'},who=C,status=403)
        invitation=self.call('POST',f'/groups/{G}/invite')
        with patch.object(api.time,'time',return_value=invitation['expiresAt']+1):
            self.call('POST','/groups/join',{'token':invitation['token'],'displayName':'C'},who=C,status=403)
        self.assertEqual(len(self.call('GET',f'/groups/{G}')['members']),2)
    def test_only_opted_in_summary_is_shared_and_never_email_or_raw_history(self):
        self.group();self.call('PUT','/progress',{'state':state(),'revision':0})
        self.assertTrue(all('summary' not in m for m in self.call('GET',f'/groups/{G}',who=B)['members']))
        self.call('PUT',f'/groups/{G}/membership',{'displayName':'Alice','shareProgress':True})
        result=self.call('GET',f'/groups/{G}',who=B)
        self.assertEqual(next(m for m in result['members'] if m['userId']==A)['summary'],{'verses':0,'practiceDays':0,'xp':0,'level':1})
        self.assertNotIn('email',json.dumps(result));self.assertNotIn('history',json.dumps(result))
        self.call('PUT',f'/groups/{G}/membership',{'displayName':'Alice','shareProgress':False})
        self.assertTrue(all('summary' not in m for m in self.call('GET',f'/groups/{G}',who=B)['members']))
    def test_shared_stack_is_member_only_and_other_members_cannot_delete_it(self):
        self.group(); self.call('POST',f'/groups/{G}/stacks',{'id':S,'name':'Peace','verseIds':[VERSE]})
        self.assertEqual(self.call('GET',f'/groups/{G}',who=B)['stacks'][0]['verseIds'],[VERSE])
        self.call('POST',f'/groups/{G}/stacks',{'id':'other-123456','name':'No','verseIds':[VERSE]},who=C,status=403)
        self.call('DELETE',f'/groups/{G}/stacks/{S}',who=B,status=403)
        self.call('DELETE',f'/groups/{G}/stacks/{S}')
        self.assertEqual(self.call('GET',f'/groups/{G}')['stacks'],[])
    def test_room_host_controls_reveal_advance_and_duplicate_responses_count_once(self):
        self.room();path=f'/groups/{G}/rooms/{R}'
        self.call('POST',path+'/answer',{'index':0,'correct':True},who=B,status=409)
        self.call('PUT',path,{'revision':1,'action':'reveal'},who=B,status=403)
        self.call('PUT',path,{'revision':1,'action':'reveal'})
        self.call('POST',path+'/answer',{'index':0,'correct':True},who=B)
        self.call('POST',path+'/answer',{'index':0,'correct':False},who=B)
        r=self.call('GET',path);self.assertEqual(r['responses'],1);self.assertEqual(r['remembered'],1)
        self.assertNotIn('Bob',json.dumps(r))
        self.call('PUT',path,{'revision':1,'action':'next'},status=409)
        self.call('PUT',path,{'revision':2,'action':'next'})
        self.call('POST',path+'/answer',{'index':0,'correct':True},who=B,status=409)
        self.assertEqual(self.call('GET',path)['index'],1)
    def test_removal_revokes_room_access_and_group_writes(self):
        self.room();self.call('DELETE',f'/groups/{G}/members/{B}')
        self.call('GET',f'/groups/{G}/rooms/{R}',who=B,status=403)
        self.call('PUT',f'/groups/{G}/membership',{'displayName':'Bob','shareProgress':True},who=B,status=403)
        self.assertEqual(self.call('GET','/groups',who=B)['groups'],[])
    def test_member_leaving_mid_write_is_rechecked_inside_transaction(self):
        self.group()
        original=api.transact
        def race(items):
            api.DB.delete_item(TableName=api.TABLE,Key=api.key('GROUP#'+G,'member#'+B))
            return original(items)
        with patch.object(api,'transact',side_effect=race):
            self.call('POST',f'/groups/{G}/stacks',{'id':S,'name':'Race','verseIds':[VERSE]},who=B,status=409)
        self.assertEqual(api.query('GROUP#'+G,'stack#'),[])
    def test_group_close_revokes_access_but_retains_personal_progress(self):
        self.group();self.call('PUT','/progress',{'state':state(),'revision':0},who=B)
        self.call('DELETE',f'/groups/{G}',who=B,status=403)
        self.call('DELETE',f'/groups/{G}')
        self.call('GET',f'/groups/{G}',who=B,status=403)
        self.assertEqual(self.call('GET','/groups',who=B)['groups'],[])
        self.assertEqual(self.call('GET','/progress',who=B)['state'],state())

if __name__=='__main__':unittest.main()
