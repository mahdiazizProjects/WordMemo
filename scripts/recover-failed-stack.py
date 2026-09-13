#!/usr/bin/env python3
"""Owner-only recovery of WordMemo's initial ROLLBACK_COMPLETE stack.

Run in CloudShell. Default is read-only; --apply saves retained resource IDs,
fixes the one ListJobs grant, and removes the failed stack record. No database,
user pool, or active infrastructure is deleted by this script.
"""
import argparse
import json
from pathlib import Path
import re
import sys

ACCOUNT = '912390896286'
REGION = 'us-west-2'
APP = 'd3p8fj75zj86rx'
STACK = 'wordmemo-sync-' + APP
PARAM = '/wordmemo/' + APP + '/deployment'


def recovery_plan(stack, resources, template, config):
    if stack.get('StackName') != STACK or stack.get('StackStatus') != 'ROLLBACK_COMPLETE':
        raise RuntimeError('Only the initial WordMemo ROLLBACK_COMPLETE stack can be recovered.')
    if {'Key': 'WordMemoBackend', 'Value': 'wordmemo-v2'} not in stack.get('Tags', []):
        raise RuntimeError('Backend ownership does not match.')
    if config.get('repository') != 'mahdiazizProjects/WordMemo':
        raise RuntimeError('Automation ownership does not match.')
    updated = dict(config)
    updated['externalUserPoolId'] = config['userPoolId']
    updated['externalHttpApiId'] = config['httpApiId']
    updated.setdefault('externalProgressTableName', '')
    updated['googleSecretArn'] = next((p.get('ParameterValue', '') for p in stack.get('Parameters', []) if p['ParameterKey'] == 'GoogleSecretArn'), config.get('googleSecretArn', ''))
    retained = {}
    for r in resources:
        name, state, physical = r['LogicalResourceId'], r['ResourceStatus'], r.get('PhysicalResourceId')
        if state == 'DELETE_COMPLETE' or (state == 'CREATE_FAILED' and not physical):
            continue
        expected = {'UserPool': 'AWS::Cognito::UserPool', 'ProgressTable': 'AWS::DynamoDB::Table'}
        definition = template.get('Resources', {}).get(name, {})
        if (name not in expected or r['ResourceType'] != expected[name] or state != 'DELETE_SKIPPED'
                or not physical or definition.get('Type') != expected[name]
                or definition.get('DeletionPolicy') != 'Retain'):
            raise RuntimeError('Resource needs individual review before recovery: ' + name + ' (' + state + ')')
        retained[name] = physical
        if name == 'UserPool' and physical != config['userPoolId']:
            raise RuntimeError('The retained account pool differs from the configured pool.')
        if name == 'ProgressTable':
            if not re.fullmatch(re.escape(STACK) + r'-ProgressTable-[A-Za-z0-9_-]+', physical):
                raise RuntimeError('Unexpected retained table name.')
            updated['externalProgressTableName'] = physical
    updated['recoveredStackId'] = stack['StackId']
    return updated, retained


def main():
    import boto3
    from botocore.exceptions import ClientError
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    session = boto3.Session(region_name=REGION)
    if session.client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise RuntimeError('Open CloudShell in AWS account ' + ACCOUNT)
    cfn, ssm, iam = [session.client(s) for s in ['cloudformation', 'ssm', 'iam']]
    config = json.loads(ssm.get_parameter(Name=PARAM)['Parameter']['Value'])
    try:
        stack = cfn.describe_stacks(StackName=STACK)['Stacks'][0]
    except ClientError as e:
        if 'does not exist' in e.response['Error'].get('Message', '') and config.get('recoveredStackId'):
            print('The failed stack was already removed. Return to ChatGPT to rerun deployment.')
            return
        raise
    resources = [r for p in cfn.get_paginator('list_stack_resources').paginate(StackName=stack['StackId']) for r in p['StackResourceSummaries']]
    template = cfn.get_template(StackName=stack['StackId'])['TemplateBody']
    if isinstance(template, str): template = json.loads(template)
    updated, retained = recovery_plan(stack, resources, template, config)
    pool = session.client('cognito-idp').describe_user_pool(UserPoolId=config['userPoolId'])['UserPool']
    api = session.client('apigatewayv2').get_api(ApiId=config['httpApiId'])
    if pool['Name'] != STACK + '-accounts' or api['Name'] != STACK + '-api':
        raise RuntimeError('Configured pool/API do not match WordMemo.')
    if 'ProgressTable' in retained:
        try:
            table = session.client('dynamodb').describe_table(TableName=retained['ProgressTable'])['Table']
            if table['TableStatus'] != 'ACTIVE': raise RuntimeError('Wait for the retained table to become ACTIVE.')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ResourceNotFoundException': raise
            # A cancelled CreateTable can have an allocated ID but no table.
            # Only a definitive AWS not-found response permits a new table.
            retained.pop('ProgressTable')
            updated['externalProgressTableName'] = ''
    name = 'WordMemoGitHub-' + APP
    role = iam.get_role(RoleName=name)['Role']
    if {'Key': 'WordMemoAutomation', 'Value': APP} not in role.get('Tags', []):
        raise RuntimeError('Deployment role ownership does not match.')
    document = iam.get_role_policy(RoleName=name, PolicyName='WordMemoOnly')['PolicyDocument']
    branch_arn = f'arn:aws:amplify:{REGION}:{ACCOUNT}:apps/{APP}/branches/production'
    grant = {'Sid': 'WordMemoProductionJobPaths', 'Effect': 'Allow',
             'Action': ['amplify:GetBranch', 'amplify:CreateDeployment', 'amplify:StartDeployment', 'amplify:GetJob', 'amplify:ListJobs'],
             'Resource': [branch_arn, branch_arn + '/*']}
    if grant not in document['Statement']: document['Statement'].append(grant)
    print(json.dumps({'failedStack': stack['StackId'], 'retainAndReuse': retained,
                      'pool': config['userPoolId'], 'api': config['httpApiId'],
                      'change': 'Remove only the rolled-back stack record and correct its hosting-history read grant'}, indent=2))
    if not args.apply:
        print('Read-only review complete. Use --apply to perform this recovery.')
        return
    Path('WordMemo-recovery.json').write_text(json.dumps({'previousConfig': config, 'nextConfig': updated, 'retained': retained, 'stack': stack['StackId']}, indent=2) + '\n')
    # Save identifiers before removing stack metadata; reruns remain recoverable.
    ssm.put_parameter(Name=PARAM, Type='String', Value=json.dumps(updated), Overwrite=True)
    iam.put_role_policy(RoleName=name, PolicyName='WordMemoOnly', PolicyDocument=json.dumps(document))
    # Recheck immediately before the only destructive API call. Persistent
    # resources have verified Retain policies; other resources are already gone.
    current = cfn.describe_stacks(StackName=stack['StackId'])['Stacks'][0]
    latest = [r for p in cfn.get_paginator('list_stack_resources').paginate(StackName=stack['StackId']) for r in p['StackResourceSummaries']]
    recovery_plan(current, latest, template, config)
    cfn.delete_stack(StackName=stack['StackId'])
    cfn.get_waiter('stack_delete_complete').wait(StackName=stack['StackId'], WaiterConfig={'Delay': 5, 'MaxAttempts': 120})
    session.client('cognito-idp').describe_user_pool(UserPoolId=config['userPoolId'])
    if 'ProgressTable' in retained:
        session.client('dynamodb').describe_table(TableName=retained['ProgressTable'])
    print('WordMemo recovery is complete. Accounts and retained progress resources were preserved.')
    print('Return to ChatGPT and say: recovery done.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Recovery stopped: ' + str(error)[:1200], file=sys.stderr)
        sys.exit(1)
