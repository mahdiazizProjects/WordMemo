"""Build the reviewable CloudFormation template from the shipped API source."""
import base64
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ref = lambda name: {'Ref': name}
sub = lambda value: {'Fn::Sub': value}
att = lambda name, attribute: {'Fn::GetAtt': [name, attribute]}


def build_template():
    books = json.loads((ROOT/'src/data/books.json').read_text())
    ranges = json.loads((ROOT/'src/data/verses.json').read_text())
    notes = json.loads((ROOT/'src/data/verse-notes.json').read_text())
    catalog = {'books': {b['id'].lower(): b['chapterLengths'] for b in books}, 'ranges': [v['id'] for v in ranges], 'notes': list(notes)}
    source = (ROOT/'backend/handler.py').read_text().replace('CATALOG = None  # CATALOG_DATA_HERE', 'CATALOG = ' + repr(catalog))
    compile(source, 'index.py', 'exec')
    # Inline compressed source keeps CloudFormation below its 51,200-byte
    # direct-template limit. The full readable source is shipped in backend/.
    encoded = base64.b64encode(gzip.compress(source.encode(), mtime=0)).decode()
    inline = f'import base64, gzip\nexec(compile(gzip.decompress(base64.b64decode({encoded!r})), "wordmemo_api.py", "exec"))\n'
    resources = {
      'ProgressTable': {'Type': 'AWS::DynamoDB::Table', 'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain', 'Properties': {
        'BillingMode': 'PAY_PER_REQUEST', 'DeletionProtectionEnabled': True,
        'AttributeDefinitions': [{'AttributeName': x, 'AttributeType': 'S'} for x in ('PK','SK')],
        'KeySchema': [{'AttributeName':'PK','KeyType':'HASH'},{'AttributeName':'SK','KeyType':'RANGE'}],
        'SSESpecification': {'SSEEnabled': True}, 'PointInTimeRecoverySpecification': {'PointInTimeRecoveryEnabled': True},
        'TimeToLiveSpecification': {'AttributeName': 'expiresAt', 'Enabled': True}}},
      'UserPool': {'Type': 'AWS::Cognito::UserPool', 'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain', 'Properties': {
        'UserPoolName': sub('${AWS::StackName}-accounts'), 'DeletionProtection': 'ACTIVE', 'UsernameAttributes': ['email'],
        'UsernameConfiguration': {'CaseSensitive': False}, 'AutoVerifiedAttributes': ['email'],
        'Schema': [{'Name': 'email', 'AttributeDataType': 'String', 'Mutable': True, 'Required': True}, {'Name': 'name', 'AttributeDataType': 'String', 'Mutable': True}],
        'Policies': {'PasswordPolicy': {'MinimumLength': 10, 'RequireLowercase': True, 'RequireUppercase': True, 'RequireNumbers': True, 'RequireSymbols': False}},
        'AccountRecoverySetting': {'RecoveryMechanisms': [{'Name': 'verified_email', 'Priority': 1}]},
        'UserAttributeUpdateSettings': {'AttributesRequireVerificationBeforeUpdate': ['email']},
        'VerificationMessageTemplate': {'DefaultEmailOption': 'CONFIRM_WITH_CODE'}}},
      'GoogleProvider': {'Type': 'AWS::Cognito::UserPoolIdentityProvider', 'Condition': 'HasGoogle', 'Properties': {
        'UserPoolId': ref('UserPool'), 'ProviderName': 'Google', 'ProviderType': 'Google',
        'ProviderDetails': {'client_id': sub('{{resolve:secretsmanager:${GoogleSecretArn}:SecretString:client_id}}'),
                            'client_secret': sub('{{resolve:secretsmanager:${GoogleSecretArn}:SecretString:client_secret}}'), 'authorize_scopes': 'openid email profile'},
        'AttributeMapping': {'email': 'email', 'email_verified': 'email_verified', 'name': 'name'}}},
      'WebClient': {'Type': 'AWS::Cognito::UserPoolClient', 'Properties': {
        'UserPoolId': ref('UserPool'), 'ClientName': 'WordMemo browser', 'GenerateSecret': False,
        'ExplicitAuthFlows': ['ALLOW_USER_SRP_AUTH','ALLOW_USER_PASSWORD_AUTH','ALLOW_REFRESH_TOKEN_AUTH'],
        'SupportedIdentityProviders': {'Fn::If': ['HasGoogle', ['COGNITO', ref('GoogleProvider')], ['COGNITO']]},
        'AllowedOAuthFlowsUserPoolClient': True, 'AllowedOAuthFlows': ['code'],
        'AllowedOAuthScopes': ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
        'CallbackURLs': [ref('AppUrl')], 'LogoutURLs': [ref('AppUrl')], 'DefaultRedirectURI': ref('AppUrl'),
        'EnableTokenRevocation': True, 'PreventUserExistenceErrors': 'ENABLED',
        'AccessTokenValidity': 1, 'IdTokenValidity': 1, 'RefreshTokenValidity': 30,
        'TokenValidityUnits': {'AccessToken': 'hours', 'IdToken': 'hours', 'RefreshToken': 'days'},
        'ReadAttributes': ['email','email_verified','name'], 'WriteAttributes': ['email','name']}},
      'LoginDomain': {'Type': 'AWS::Cognito::UserPoolDomain', 'Properties': {'Domain': ref('DomainPrefix'), 'UserPoolId': ref('UserPool'), 'ManagedLoginVersion': 1}},
      'ApiRole': {'Type': 'AWS::IAM::Role', 'Properties': {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
        'Policies': [{'PolicyName':'WordMemoData', 'PolicyDocument': {'Version':'2012-10-17','Statement': [
          {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:Query','dynamodb:ConditionCheckItem'], 'Resource': att('ProgressTable','Arn')},
          {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-api:*')}
        ]}}]}},
      'ApiLogGroup': {'Type': 'AWS::Logs::LogGroup', 'Properties': {'LogGroupName':sub('/aws/lambda/${AWS::StackName}-api'), 'RetentionInDays':14}},
      'ApiFunction': {'Type': 'AWS::Lambda::Function', 'DependsOn':'ApiLogGroup', 'Properties': {
        'FunctionName': sub('${AWS::StackName}-api'), 'Runtime':'python3.12', 'Handler':'index.handler', 'MemorySize':512, 'Timeout':25,
        'Role': att('ApiRole','Arn'), 'Code': {'ZipFile':inline},
        'Environment': {'Variables': {'TABLE_NAME':ref('ProgressTable'), 'CLIENT_ID':ref('WebClient')}}}},
      'HttpApi': {'Type': 'AWS::ApiGatewayV2::Api', 'Properties': {'Name': sub('${AWS::StackName}-api'), 'ProtocolType':'HTTP',
        'CorsConfiguration': {'AllowOrigins': [ref('AppOrigin')], 'AllowMethods':['GET','POST','PUT','DELETE','OPTIONS'], 'AllowHeaders':['authorization','content-type'], 'MaxAge':3600}}},
      'Authorizer': {'Type':'AWS::ApiGatewayV2::Authorizer', 'Properties': {'ApiId':ref('HttpApi'),'AuthorizerType':'JWT','Name':'WordMemo accounts','IdentitySource':['$request.header.Authorization'],
        'JwtConfiguration': {'Audience':[ref('WebClient')], 'Issuer':sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}')}}},
      'Integration': {'Type':'AWS::ApiGatewayV2::Integration', 'Properties': {'ApiId':ref('HttpApi'),'IntegrationType':'AWS_PROXY','IntegrationUri':att('ApiFunction','Arn'),'PayloadFormatVersion':'2.0','TimeoutInMillis':29000}},
      'Stage': {'Type':'AWS::ApiGatewayV2::Stage','Properties': {'ApiId':ref('HttpApi'),'StageName':'$default','AutoDeploy':True,'DefaultRouteSettings':{'ThrottlingBurstLimit':100,'ThrottlingRateLimit':50}}},
      'InvokePermission': {'Type':'AWS::Lambda::Permission','Properties': {'Action':'lambda:InvokeFunction','FunctionName':ref('ApiFunction'),'Principal':'apigateway.amazonaws.com','SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*')}}
    }
    for name, route in [('Health','GET /health'),('ProgressRead','GET /progress'),('ProgressWrite','PUT /progress'),('GroupsRead','GET /groups'),('GroupsCreate','POST /groups'),('GroupActions','ANY /groups/{proxy+}')]:
        props = {'ApiId':ref('HttpApi'),'RouteKey':route,'Target':{'Fn::Join':['/', ['integrations',ref('Integration')]]}, 'AuthorizationType':'NONE' if name == 'Health' else 'JWT'}
        if name != 'Health': props.update(AuthorizerId=ref('Authorizer'), AuthorizationScopes=['aws.cognito.signin.user.admin'])
        resources[name+'Route'] = {'Type':'AWS::ApiGatewayV2::Route','Properties':props}
    # The one-time access setup preallocates IDs when no stack-owned pool/API
    # exists. This lets the deployment role target exact resources in IAM.
    # Defaults keep existing installations under CloudFormation management.
    pool_id = {'Fn::If': ['UseExternalPool', ref('ExternalUserPoolId'), ref('UserPool')]}
    api_id = {'Fn::If': ['UseExternalApi', ref('ExternalHttpApiId'), ref('HttpApi')]}
    resources['UserPool']['Condition'] = 'CreateUserPool'
    resources['HttpApi']['Condition'] = 'CreateHttpApi'
    resources['UserPool']['Properties']['UserPoolTags'] = {'WordMemoBackend': 'wordmemo-v2'}
    resources['HttpApi']['Properties']['Tags'] = {'WordMemoBackend': 'wordmemo-v2'}
    resources['ApiRole']['Properties']['PermissionsBoundary'] = {'Fn::If': ['UseRuntimeBoundary', ref('RuntimeBoundaryArn'), ref('AWS::NoValue')]}
    for name in ('GoogleProvider', 'WebClient', 'LoginDomain'):
        resources[name]['Properties']['UserPoolId'] = pool_id
    for resource in resources.values():
        if 'ApiId' in resource['Properties']:
            resource['Properties']['ApiId'] = api_id
    resources['Authorizer']['Properties']['JwtConfiguration']['Issuer'] = {
        'Fn::Sub': ['https://cognito-idp.${AWS::Region}.amazonaws.com/${PoolId}', {'PoolId': pool_id}]}
    resources['InvokePermission']['Properties']['SourceArn'] = {
        'Fn::Sub': ['arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${ApiId}/*', {'ApiId': api_id}]}
    return {'AWSTemplateFormatVersion':'2010-09-09','Description':'WordMemo v2: private progress, Cognito sign-in, life groups and shared practice.',
      'Parameters': {'AppUrl': {'Type':'String','AllowedPattern':'https://production\\.[a-z0-9]+\\.amplifyapp\\.com/'}, 'AppOrigin':{'Type':'String','AllowedPattern':'https://production\\.[a-z0-9]+\\.amplifyapp\\.com'},
                     'DomainPrefix':{'Type':'String','AllowedPattern':'[a-z0-9-]{1,63}'}, 'GoogleSecretArn':{'Type':'String','Default':'','AllowedPattern':'(^$|arn:aws:secretsmanager:[a-z0-9-]+:912390896286:secret:wordmemo/google/[A-Za-z0-9/_+=.@-]+)'},
                     'ExternalUserPoolId': {'Type': 'String', 'Default': '', 'AllowedPattern': '(^$|us-west-2_[A-Za-z0-9]+)'},
                     'ExternalHttpApiId': {'Type': 'String', 'Default': '', 'AllowedPattern': '[a-z0-9]*'},
                     'RuntimeBoundaryArn': {'Type': 'String', 'Default': '', 'AllowedPattern': '(^$|arn:aws:iam::912390896286:policy/WordMemoRuntimeBoundary-d3p8fj75zj86rx)'}},
      'Conditions': {'HasGoogle': {'Fn::Not':[{'Fn::Equals':[ref('GoogleSecretArn'),'']}]},
                     'UseExternalPool': {'Fn::Not': [{'Fn::Equals': [ref('ExternalUserPoolId'), '']}]},
                     'UseExternalApi': {'Fn::Not': [{'Fn::Equals': [ref('ExternalHttpApiId'), '']}]},
                     'CreateUserPool': {'Fn::Equals': [ref('ExternalUserPoolId'), '']},
                     'CreateHttpApi': {'Fn::Equals': [ref('ExternalHttpApiId'), '']},
                     'UseRuntimeBoundary': {'Fn::Not': [{'Fn::Equals': [ref('RuntimeBoundaryArn'), '']}]}}, 'Resources':resources,
      'Outputs': {'UserPoolId':{'Value':pool_id}, 'ClientId':{'Value':ref('WebClient')}, 'ApiUrl':{'Value':{'Fn::Sub': ['https://${ApiId}.execute-api.${AWS::Region}.amazonaws.com', {'ApiId': api_id}]}}, 'TableName':{'Value':ref('ProgressTable')},
                  'Domain':{'Value':sub('${DomainPrefix}.auth.${AWS::Region}.amazoncognito.com')}, 'GoogleEnabled':{'Value':{'Fn::If':['HasGoogle','true','false']}}}}

if __name__ == '__main__':
    result = json.dumps(build_template(), separators=(',', ':'))
    assert len(result.encode()) < 51200
    (ROOT/'backend/template.json').write_text(result+'\n')
    print(f'Backend template: {len(result):,} bytes; Lambda source compiled.')
