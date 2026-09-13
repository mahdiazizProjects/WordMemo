#!/usr/bin/env python3
"""One-time CloudShell setup for WordMemo's GitHub OIDC deployment.

No keys are created. Run --apply using your existing AWS console session.
Creates only WordMemo automation roles, a permissions boundary, a non-secret
SSM configuration, and (when missing) this app's Cognito pool and HTTP API.
Existing CloudFormation-owned resources are reused without replacing them.
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
REPO = 'mahdiazizProjects/WordMemo'
SUBJECT = 'repo:mahdiazizProjects@34470394/WordMemo@1368281544:ref:refs/heads/main'
URL = 'https://production.' + APP + '.amplifyapp.com/'
TAG = {'WordMemoAutomation': APP}
BACKEND_TAG = {'WordMemoBackend': 'wordmemo-v2'}
DEPLOY_ROLE = 'WordMemoGitHub-' + APP
CFN_ROLE = 'WordMemoCloudFormation-' + APP
BOUNDARY = 'WordMemoRuntimeBoundary-' + APP
PARAMETER = '/wordmemo/' + APP + '/deployment'


def arn(service, resource, region=REGION):
    return f'arn:aws:{service}:{region}:{ACCOUNT}:{resource}'


def iam_arn(resource):
    return arn('iam', resource, '')


def policy(*statements):
    return {'Version': '2012-10-17', 'Statement': list(statements)}


def allow(actions, resources, condition=None):
    value = {'Effect': 'Allow', 'Action': actions, 'Resource': resources}
    if condition:
        value['Condition'] = condition
    return value


def trust():
    return policy({'Effect': 'Allow', 'Principal': {'Federated': iam_arn('oidc-provider/token.actions.githubusercontent.com')},
                   'Action': 'sts:AssumeRoleWithWebIdentity', 'Condition': {'StringEquals': {
                       'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                       'token.actions.githubusercontent.com:sub': SUBJECT}}})


def policies(pool_id, api_id, old_runtime_role=None, table_name=None):
    if not re.fullmatch(r'us-west-2_[A-Za-z0-9]+', pool_id) or not re.fullmatch(r'[a-z0-9]+', api_id):
        raise ValueError('Invalid WordMemo resource identifiers.')
    pool = arn('cognito-idp', 'userpool/' + pool_id)
    api = f'arn:aws:apigateway:{REGION}::/apis/{api_id}'
    tables = [arn('dynamodb', 'table/' + STACK + '-ProgressTable-*')]
    if table_name:
        if not re.fullmatch(re.escape(STACK) + r'-ProgressTable-[A-Za-z0-9_-]+', table_name):
            raise ValueError('Unexpected WordMemo table name.')
        tables = [arn('dynamodb', 'table/' + table_name), *tables]
    log = arn('logs', 'log-group:/aws/lambda/' + STACK + '-api')
    function = arn('lambda', 'function:' + STACK + '-api')
    runtime_roles = [iam_arn('role/' + STACK + '-ApiRole-*')]
    if old_runtime_role:
        if not re.fullmatch(re.escape(STACK) + r'-ApiRole-[A-Za-z0-9_-]+', old_runtime_role):
            raise ValueError('Unexpected WordMemo runtime role name.')
        runtime_roles.append(iam_arn('role/' + old_runtime_role))
    boundary_arn = iam_arn('policy/' + BOUNDARY)
    runtime = policy(
        allow(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:ConditionCheckItem'], tables),
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'], log + ':*'))
    cfn = policy(
        allow(['dynamodb:CreateTable', 'dynamodb:DescribeTable', 'dynamodb:UpdateTable', 'dynamodb:DescribeTimeToLive',
               'dynamodb:UpdateTimeToLive', 'dynamodb:DescribeContinuousBackups', 'dynamodb:UpdateContinuousBackups',
               'dynamodb:ListTagsOfResource', 'dynamodb:TagResource', 'dynamodb:UntagResource'], tables),
        allow(['cognito-idp:DescribeUserPool', 'cognito-idp:UpdateUserPool', 'cognito-idp:ListTagsForResource',
               'cognito-idp:TagResource', 'cognito-idp:UntagResource',
               'cognito-idp:CreateUserPoolClient', 'cognito-idp:DescribeUserPoolClient', 'cognito-idp:UpdateUserPoolClient', 'cognito-idp:DeleteUserPoolClient',
               'cognito-idp:CreateUserPoolDomain', 'cognito-idp:UpdateUserPoolDomain', 'cognito-idp:DeleteUserPoolDomain',
               'cognito-idp:CreateIdentityProvider', 'cognito-idp:DescribeIdentityProvider', 'cognito-idp:UpdateIdentityProvider', 'cognito-idp:DeleteIdentityProvider'], pool),
        # DescribeUserPoolDomain has no resource-level IAM support.
        allow('cognito-idp:DescribeUserPoolDomain', '*', {'StringEquals': {'aws:RequestedRegion': REGION}}),
        allow(['apigateway:GET', 'apigateway:POST', 'apigateway:PUT', 'apigateway:PATCH', 'apigateway:DELETE'], [api, api + '/*']),
        allow(['lambda:CreateFunction', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode',
               'lambda:UpdateFunctionConfiguration', 'lambda:DeleteFunction', 'lambda:GetPolicy', 'lambda:AddPermission',
               'lambda:RemovePermission', 'lambda:ListTags', 'lambda:TagResource', 'lambda:UntagResource'], function),
        allow(['logs:CreateLogGroup', 'logs:PutRetentionPolicy', 'logs:DeleteRetentionPolicy', 'logs:DeleteLogGroup',
               'logs:ListTagsForResource', 'logs:TagResource', 'logs:UntagResource', 'logs:TagLogGroup', 'logs:UntagLogGroup'], [log, log + ':*']),
        allow('logs:DescribeLogGroups', '*', {'StringEquals': {'aws:RequestedRegion': REGION}}),
        allow('iam:CreateRole', runtime_roles, {'StringEquals': {'iam:PermissionsBoundary': boundary_arn}}),
        allow('iam:PutRolePermissionsBoundary', runtime_roles, {'StringEquals': {'iam:PermissionsBoundary': boundary_arn}}),
        allow(['iam:GetRole', 'iam:DeleteRole', 'iam:UpdateAssumeRolePolicy', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy',
               'iam:GetRolePolicy', 'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies', 'iam:TagRole', 'iam:UntagRole', 'iam:ListRoleTags'], runtime_roles),
        allow('iam:PassRole', runtime_roles, {'StringEquals': {'iam:PassedToService': 'lambda.amazonaws.com'}}),
        allow('secretsmanager:GetSecretValue', arn('secretsmanager', 'secret:wordmemo/google/' + APP + '/*')))
    amplify = arn('amplify', 'apps/' + APP)
    branch = amplify + '/branches/production'
    stack = arn('cloudformation', 'stack/' + STACK + '/*')
    deploy = policy(
        allow(['amplify:GetApp', 'amplify:UpdateApp'], amplify),
        allow(['amplify:GetBranch', 'amplify:CreateBranch', 'amplify:CreateDeployment', 'amplify:StartDeployment', 'amplify:ListJobs', 'amplify:TagResource'], branch),
        allow(['amplify:GetJob', 'amplify:ListJobs'], branch + '/jobs/*'),
        allow(['amplify:GetBranch', 'amplify:CreateDeployment', 'amplify:StartDeployment', 'amplify:GetJob', 'amplify:ListJobs'], branch + '/*'),
        allow(['cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents', 'cloudformation:DescribeStackResource',
               'cloudformation:DescribeStackResources', 'cloudformation:ListStackResources', 'cloudformation:GetTemplate', 'cloudformation:GetStackPolicy'], stack),
        allow(['cloudformation:CreateStack', 'cloudformation:UpdateStack', 'cloudformation:ContinueUpdateRollback',
               'cloudformation:RollbackStack', 'cloudformation:CancelUpdateStack'], stack,
              {'StringEquals': {'cloudformation:RoleArn': iam_arn('role/' + CFN_ROLE)}}),
        allow('cloudformation:ValidateTemplate', '*'),
        allow('iam:PassRole', iam_arn('role/' + CFN_ROLE), {'StringEquals': {'iam:PassedToService': 'cloudformation.amazonaws.com'}}),
        allow('ssm:GetParameter', arn('ssm', 'parameter' + PARAMETER)),
        # The synthetic-account checks require these pool-level permissions;
        # Cognito cannot restrict these admin APIs by username in IAM.
        allow(['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminDeleteUser',
               'cognito-idp:DescribeUserPool', 'cognito-idp:DescribeUserPoolClient'], pool),
        allow(['dynamodb:Query', 'dynamodb:DeleteItem', 'dynamodb:DescribeTable'], tables),
        allow(['lambda:GetFunctionConfiguration'], function),
        allow(['logs:DescribeLogStreams', 'logs:GetLogEvents', 'logs:FilterLogEvents'], log + ':*'))
    return {'runtime': runtime, 'cloudformation': cfn, 'deploy': deploy}


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create the reviewed WordMemo access setup')
    args = parser.parse_args()
    if not args.apply:
        print(json.dumps({'account': ACCOUNT, 'region': REGION, 'repository': REPO, 'trust': trust(),
                          'roles': [DEPLOY_ROLE, CFN_ROLE], 'boundary': BOUNDARY,
                          'scope': 'Existing WordMemo Amplify app, backend stack, exact Cognito pool and HTTP API, app table and Lambda.',
                          'apply': 'python3 authorize-aws.py --apply'}, indent=2))
        return
    import boto3
    from botocore.exceptions import ClientError
    session = boto3.Session(region_name=REGION)
    if session.client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise RuntimeError('Wrong AWS account. Open CloudShell in account ' + ACCOUNT + '.')
    clients = {s: session.client(s) for s in ['amplify', 'cloudformation', 'iam', 'ssm', 'cognito-idp', 'apigatewayv2']}
    app = clients['amplify'].get_app(appId=APP)['app']
    if app.get('tags', {}).get('WordMemoDeployment') != 'wordmemo-public-web-v1' or app.get('platform') != 'WEB':
        raise RuntimeError('The target Amplify app does not match WordMemo. Nothing changed.')
    ssm, cfn, iam = clients['ssm'], clients['cloudformation'], clients['iam']
    saved = {}
    try:
        saved = json.loads(ssm.get_parameter(Name=PARAMETER)['Parameter']['Value'])
        if saved.get('repository') != REPO:
            raise RuntimeError('An unrelated automation configuration exists. It was left unchanged.')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ParameterNotFound': raise
    stack, resources = None, {}
    try:
        stack = cfn.describe_stacks(StackName=STACK)['Stacks'][0]
        if not all({'Key': k, 'Value': v} in stack.get('Tags', []) for k, v in BACKEND_TAG.items()):
            raise RuntimeError('The backend stack has unexpected ownership. It was left unchanged.')
        for page in cfn.get_paginator('list_stack_resources').paginate(StackName=STACK):
            for r in page['StackResourceSummaries']:
                if r.get('PhysicalResourceId') and r.get('ResourceStatus') != 'DELETE_COMPLETE':
                    resources[r['LogicalResourceId']] = r['PhysicalResourceId']
        print('Existing backend status: ' + stack['StackStatus'], flush=True)
    except ClientError as e:
        if 'does not exist' not in e.response['Error'].get('Message', ''): raise
    if stack and stack['StackStatus'].endswith('_IN_PROGRESS'):
        raise RuntimeError('AWS is still changing the backend. Let it finish, then rerun this setup.')
    cognito, gateway = clients['cognito-idp'], clients['apigatewayv2']
    pool = resources.get('UserPool') or saved.get('userPoolId')
    if not pool:
        # Recover a prior interrupted bootstrap by exact name plus ownership tag.
        pools = []
        for page in cognito.get_paginator('list_user_pools').paginate(MaxResults=60):
            for p in page['UserPools']:
                if p['Name'] == STACK + '-accounts':
                    detail = cognito.describe_user_pool(UserPoolId=p['Id'])['UserPool']
                    if detail.get('UserPoolTags', {}).get('WordMemoBackend') == 'wordmemo-v2': pools.append(p['Id'])
        if len(pools) > 1:
            raise RuntimeError('Multiple WordMemo account pools exist. No pool was replaced.')
        pool = pools[0] if pools else None
    if not pool:
        print('Creating WordMemo account pool with deletion protection...', flush=True)
        pool = cognito.create_user_pool(PoolName=STACK + '-accounts', DeletionProtection='ACTIVE',
            UsernameAttributes=['email'], UsernameConfiguration={'CaseSensitive': False}, AutoVerifiedAttributes=['email'],
            Schema=[{'Name': 'email', 'AttributeDataType': 'String', 'Mutable': True, 'Required': True}, {'Name': 'name', 'AttributeDataType': 'String', 'Mutable': True}],
            Policies={'PasswordPolicy': {'MinimumLength': 10, 'RequireLowercase': True, 'RequireUppercase': True, 'RequireNumbers': True, 'RequireSymbols': False}},
            AccountRecoverySetting={'RecoveryMechanisms': [{'Name': 'verified_email', 'Priority': 1}]},
            UserAttributeUpdateSettings={'AttributesRequireVerificationBeforeUpdate': ['email']},
            VerificationMessageTemplate={'DefaultEmailOption': 'CONFIRM_WITH_CODE'}, UserPoolTags={**TAG, **BACKEND_TAG})['UserPool']['Id']
    detail = cognito.describe_user_pool(UserPoolId=pool)['UserPool']
    if resources.get('UserPool') == pool and detail['Name'] == STACK + '-accounts':
        cognito.tag_resource(ResourceArn=detail['Arn'], Tags=BACKEND_TAG)
        detail['UserPoolTags'] = {**detail.get('UserPoolTags', {}), **BACKEND_TAG}
    if detail['Name'] != STACK + '-accounts' or detail.get('UserPoolTags', {}).get('WordMemoBackend') != 'wordmemo-v2':
        raise RuntimeError('Unexpected Cognito pool. No access to that pool was granted.')
    api_id = resources.get('HttpApi') or saved.get('httpApiId')
    if not api_id:
        matches = []
        for page in gateway.get_paginator('get_apis').paginate():
            matches.extend(a['ApiId'] for a in page.get('Items', []) if a.get('Name') == STACK + '-api' and a.get('Tags', {}).get('WordMemoBackend') == 'wordmemo-v2')
        if len(matches) > 1:
            raise RuntimeError('Multiple WordMemo HTTP APIs exist. No API was replaced.')
        api_id = matches[0] if matches else None
    if not api_id:
        print('Creating the WordMemo HTTP API endpoint...', flush=True)
        api_id = gateway.create_api(Name=STACK + '-api', ProtocolType='HTTP', Tags={**TAG, **BACKEND_TAG},
            CorsConfiguration={'AllowOrigins': [URL.rstrip('/')], 'AllowMethods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 'AllowHeaders': ['authorization', 'content-type'], 'MaxAge': 3600})['ApiId']
    detail = gateway.get_api(ApiId=api_id)
    if resources.get('HttpApi') == api_id and detail['Name'] == STACK + '-api':
        gateway.tag_resource(ResourceArn=f'arn:aws:apigateway:{REGION}::/apis/{api_id}', Tags=BACKEND_TAG)
        detail['Tags'] = {**detail.get('Tags', {}), **BACKEND_TAG}
    if detail['Name'] != STACK + '-api' or detail.get('Tags', {}).get('WordMemoBackend') != 'wordmemo-v2':
        raise RuntimeError('Unexpected HTTP API. No access to that API was granted.')
    generated = policies(pool, api_id, resources.get('ApiRole'), resources.get('ProgressTable'))
    provider = iam_arn('oidc-provider/token.actions.githubusercontent.com')
    try:
        existing = iam.get_open_id_connect_provider(OpenIDConnectProviderArn=provider)
        if 'sts.amazonaws.com' not in existing['ClientIDList']:
            iam.add_client_id_to_open_id_connect_provider(OpenIDConnectProviderArn=provider, ClientID='sts.amazonaws.com')
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchEntity': raise
        iam.create_open_id_connect_provider(Url='https://token.actions.githubusercontent.com', ClientIDList=['sts.amazonaws.com'], Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])
    boundary_arn = iam_arn('policy/' + BOUNDARY)
    try:
        current = iam.get_policy(PolicyArn=boundary_arn)['Policy']
        tags = iam.list_policy_tags(PolicyArn=boundary_arn)['Tags']
        if not all({'Key': k, 'Value': v} in tags for k, v in TAG.items()):
            raise RuntimeError('An unrelated permissions boundary has this name.')
        old = iam.get_policy_version(PolicyArn=boundary_arn, VersionId=current['DefaultVersionId'])['PolicyVersion']['Document']
        if old != generated['runtime']:
            versions = iam.list_policy_versions(PolicyArn=boundary_arn)['Versions']
            if len(versions) >= 5:
                candidate = min((v for v in versions if not v['IsDefaultVersion']), key=lambda v: v['CreateDate'])
                iam.delete_policy_version(PolicyArn=boundary_arn, VersionId=candidate['VersionId'])
            iam.create_policy_version(PolicyArn=boundary_arn, PolicyDocument=json.dumps(generated['runtime']), SetAsDefault=True)
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchEntity': raise
        iam.create_policy(PolicyName=BOUNDARY, PolicyDocument=json.dumps(generated['runtime']), Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])
    if resources.get('ApiRole'):
        # Close an existing role's privilege ceiling before permitting updates.
        iam.put_role_permissions_boundary(RoleName=resources['ApiRole'], PermissionsBoundary=boundary_arn)
    service_trust = policy({'Effect': 'Allow', 'Principal': {'Service': 'cloudformation.amazonaws.com'}, 'Action': 'sts:AssumeRole'})
    for name, assume, permissions in [(CFN_ROLE, service_trust, generated['cloudformation']), (DEPLOY_ROLE, trust(), generated['deploy'])]:
        try:
            current = iam.get_role(RoleName=name)['Role']
            if not all({'Key': k, 'Value': v} in current.get('Tags', []) for k, v in TAG.items()):
                raise RuntimeError('An unrelated IAM role has the name ' + name)
            if iam.list_attached_role_policies(RoleName=name)['AttachedPolicies']:
                raise RuntimeError('The automation role has additional managed policies. Review them before reauthorizing.')
            if set(iam.list_role_policies(RoleName=name)['PolicyNames']) - {'WordMemoOnly'}:
                raise RuntimeError('The automation role has additional inline policies. Review them before reauthorizing.')
            iam.update_assume_role_policy(RoleName=name, PolicyDocument=json.dumps(assume))
            iam.update_role(RoleName=name, MaxSessionDuration=7200)
        except ClientError as e:
            if e.response['Error']['Code'] != 'NoSuchEntity': raise
            iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps(assume), MaxSessionDuration=7200,
                            Tags=[{'Key': k, 'Value': v} for k, v in TAG.items()])
        iam.put_role_policy(RoleName=name, PolicyName='WordMemoOnly', PolicyDocument=json.dumps(permissions))
    config = {'version': 1, 'repository': REPO, 'subject': SUBJECT, 'userPoolId': pool, 'httpApiId': api_id,
              'externalUserPoolId': '' if resources.get('UserPool') else pool,
              'externalHttpApiId': '' if resources.get('HttpApi') else api_id,
              'externalProgressTableName': saved.get('externalProgressTableName', ''),
              'googleSecretArn': saved.get('googleSecretArn', ''),
              'cloudFormationRoleArn': iam_arn('role/' + CFN_ROLE), 'runtimeBoundaryArn': boundary_arn}
    ssm.put_parameter(Name=PARAMETER, Type='String', Value=json.dumps(config), Overwrite=True,
                      Description='WordMemo deployment identifiers; no credentials')
    Path('WordMemo-authorization.json').write_text(json.dumps({'config': config, 'policies': generated}, indent=2) + '\n')
    print('\nWordMemo GitHub access is ready. No access keys were created.')
    print('Role: ' + iam_arn('role/' + DEPLOY_ROLE))
    print('GitHub: https://github.com/' + REPO + '/actions')
    print('Return to ChatGPT and say: AWS access is ready. The deployment can then be rerun.')


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        # API messages are useful here, but never dump responses or credentials.
        print('WordMemo authorization stopped: ' + str(error)[:1200], file=sys.stderr)
        sys.exit(1)
