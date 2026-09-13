import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recover', ROOT/'scripts/recover-failed-stack.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.stack = {'StackName': r.STACK, 'StackStatus': 'ROLLBACK_COMPLETE', 'StackId': 'exact-id', 'Tags': [{'Key': 'WordMemoBackend', 'Value': 'wordmemo-v2'}]}
        self.config = {'repository': 'mahdiazizProjects/WordMemo', 'userPoolId': 'us-west-2_pool', 'httpApiId': 'api'}
        self.resources = [{'LogicalResourceId': 'UserPool', 'ResourceType': 'AWS::Cognito::UserPool', 'ResourceStatus': 'DELETE_SKIPPED', 'PhysicalResourceId': 'us-west-2_pool'}]
        self.template = {'Resources': {'UserPool': {'Type': 'AWS::Cognito::UserPool', 'DeletionPolicy': 'Retain'}}}

    def test_preserves_exact_retained_account_pool(self):
        config, retained = r.recovery_plan(self.stack, self.resources, self.template, self.config)
        self.assertEqual(config['externalUserPoolId'], 'us-west-2_pool')
        self.assertEqual(retained, {'UserPool': 'us-west-2_pool'})

    def test_live_or_unowned_stack_is_rejected(self):
        for changes in [{'StackStatus': 'CREATE_COMPLETE'}, {'StackName': 'other'}, {'Tags': []}]:
            with self.assertRaises(RuntimeError): r.recovery_plan({**self.stack, **changes}, self.resources, self.template, self.config)

    def test_any_unreviewed_remaining_resource_is_rejected(self):
        for status in ['CREATE_COMPLETE', 'DELETE_FAILED', 'CREATE_FAILED']:
            bad = {'LogicalResourceId': 'Other', 'ResourceType': 'AWS::Lambda::Function', 'ResourceStatus': status, 'PhysicalResourceId': 'exists'}
            with self.assertRaises(RuntimeError): r.recovery_plan(self.stack, [*self.resources, bad], self.template, self.config)

    def test_missing_retention_or_different_pool_is_rejected(self):
        with self.assertRaises(RuntimeError): r.recovery_plan(self.stack, self.resources, {'Resources': {}}, self.config)
        with self.assertRaises(RuntimeError): r.recovery_plan(self.stack, self.resources, self.template, {**self.config, 'userPoolId': 'another'})

    def test_retained_progress_table_is_reused_not_replaced(self):
        table = r.STACK + '-ProgressTable-Existing'
        resources = [*self.resources, {'LogicalResourceId': 'ProgressTable', 'ResourceType': 'AWS::DynamoDB::Table', 'ResourceStatus': 'DELETE_SKIPPED', 'PhysicalResourceId': table}]
        template = {'Resources': {**self.template['Resources'], 'ProgressTable': {'Type': 'AWS::DynamoDB::Table', 'DeletionPolicy': 'Retain'}}}
        config, retained = r.recovery_plan(self.stack, resources, template, self.config)
        self.assertEqual(config['externalProgressTableName'], table)
        self.assertEqual(retained['ProgressTable'], table)


if __name__ == '__main__': unittest.main()
