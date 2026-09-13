"""Security boundaries for the unattended deployment path."""
import fnmatch
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('access', ROOT/'scripts/authorize-aws.py')
access = importlib.util.module_from_spec(spec)
spec.loader.exec_module(access)
from test_deploy_aws import deploy


def candidates(document, action, resource):
    """Candidates before IAM conditions, enough to prove unrelated ARNs denied."""
    def values(v): return v if isinstance(v, list) else [v]
    return [s for s in document['Statement'] if s['Effect'] == 'Allow'
            and any(fnmatch.fnmatchcase(action.lower(), a.lower()) for a in values(s['Action']))
            and any(fnmatch.fnmatchcase(resource, r) for r in values(s['Resource']))]


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.p = access.policies('us-west-2_Example123', 'abcdef1234')

    def test_only_actual_repository_main_subject_is_trusted(self):
        statement = access.trust()['Statement'][0]
        condition = statement['Condition']['StringEquals']
        self.assertEqual(condition['token.actions.githubusercontent.com:sub'],
                         'repo:mahdiazizProjects@34470394/WordMemo@1368281544:ref:refs/heads/main')
        self.assertEqual(condition['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com')
        self.assertNotIn('*', json.dumps(statement))

    def test_other_apps_pools_tables_roles_and_apis_are_not_allowed(self):
        cases = [
            ('deploy', 'amplify:UpdateApp', access.arn('amplify', 'apps/someOtherApp')),
            ('deploy', 'amplify:CreateDeployment', access.arn('amplify', 'apps/' + access.APP + '/branches/preview')),
            ('deploy', 'cloudformation:UpdateStack', access.arn('cloudformation', 'stack/unrelated/id')),
            ('deploy', 'ssm:GetParameter', access.arn('ssm', 'parameter/unrelated')),
            ('cloudformation', 'cognito-idp:UpdateUserPool', access.arn('cognito-idp', 'userpool/us-west-2_Other')),
            ('cloudformation', 'apigateway:PATCH', 'arn:aws:apigateway:us-west-2::/apis/otherid/routes/id'),
            ('cloudformation', 'iam:PutRolePolicy', access.iam_arn('role/' + access.DEPLOY_ROLE)),
            ('cloudformation', 'iam:PutRolePolicy', access.iam_arn('role/Administrator')),
            ('runtime', 'dynamodb:GetItem', access.arn('dynamodb', 'table/AnotherApp')),
            ('runtime', 'iam:CreateUser', '*')]
        for kind, action, resource in cases:
            with self.subTest(action=action, resource=resource):
                self.assertEqual(candidates(self.p[kind], action, resource), [])

    def test_runtime_boundary_cannot_be_removed_or_widened(self):
        resource = access.iam_arn('role/' + access.STACK + '-ApiRole-Example')
        expected = access.iam_arn('policy/' + access.BOUNDARY)
        for action in ['iam:CreateRole', 'iam:PutRolePermissionsBoundary']:
            grants = candidates(self.p['cloudformation'], action, resource)
            self.assertTrue(grants)
            self.assertTrue(all(s['Condition']['StringEquals']['iam:PermissionsBoundary'] == expected for s in grants))
        for kind in self.p:
            for action in ['iam:DeleteRolePermissionsBoundary', 'iam:CreatePolicyVersion', 'iam:CreateAccessKey', 'iam:CreateUser']:
                self.assertEqual(candidates(self.p[kind], action, resource), [])

    def test_no_permission_to_delete_persistent_resources_or_stack(self):
        for kind in self.p:
            for action, resource in [
                ('dynamodb:DeleteTable', access.arn('dynamodb', 'table/' + access.STACK + '-ProgressTable-X')),
                ('cognito-idp:DeleteUserPool', access.arn('cognito-idp', 'userpool/us-west-2_Example123')),
                ('cloudformation:DeleteStack', access.arn('cloudformation', 'stack/' + access.STACK + '/id'))]:
                self.assertEqual(candidates(self.p[kind], action, resource), [])

    def test_cloudformation_must_use_the_restricted_service_role(self):
        grants = candidates(self.p['deploy'], 'cloudformation:UpdateStack', access.arn('cloudformation', 'stack/' + access.STACK + '/id'))
        self.assertTrue(grants)
        self.assertTrue(all(s['Condition']['StringEquals']['cloudformation:RoleArn'] == access.iam_arn('role/' + access.CFN_ROLE) for s in grants))

    def test_automation_ref_and_config_fail_closed(self):
        with patch.dict(os.environ, {'WORDMEMO_AUTOMATION': '1', 'GITHUB_REPOSITORY': access.REPO, 'GITHUB_REF': 'refs/heads/untrusted'}):
            with self.assertRaisesRegex(RuntimeError, 'main branch'):
                deploy.automation_config(lambda *args: self.fail('AWS must not be called'))
        with patch.dict(os.environ, {'WORDMEMO_AUTOMATION': '1', 'GITHUB_REPOSITORY': access.REPO, 'GITHUB_REF': 'refs/heads/main'}):
            with self.assertRaisesRegex(RuntimeError, 'Unexpected automation'):
                deploy.automation_config(lambda *args: {'Parameter': {'Value': '{}'}})

    def test_permission_documents_fit_role_inline_quota(self):
        for document in self.p.values():
            self.assertLess(len(json.dumps(document, separators=(',', ':'))), 10240)


if __name__ == '__main__':
    unittest.main()
