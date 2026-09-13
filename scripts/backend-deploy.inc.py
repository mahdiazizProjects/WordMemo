# Backend deployment helpers. Included verbatim in the self-contained installer.
BACKEND_TEMPLATE = {}  # Filled by the release builder.
WORKER_TEMPLATE = ''
TARGET_APP_ID = 'd3p8fj75zj86rx'
BACKEND_TAG = {'WordMemoBackend': 'wordmemo-v2'}


def automation_config(api):
    """Read non-secret IDs; fail closed instead of falling back to broad IAM."""
    if os.environ.get('WORDMEMO_AUTOMATION') != '1':
        return None
    if os.environ.get('GITHUB_REPOSITORY') != 'mahdiazizProjects/WordMemo' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Automatic deployment is restricted to the WordMemo main branch.')
    value = api('ssm', 'get-parameter', {'Name': '/wordmemo/' + TARGET_APP_ID + '/deployment'})
    config = json.loads(value['Parameter']['Value'])
    if (config.get('repository') != 'mahdiazizProjects/WordMemo'
            or config.get('cloudFormationRoleArn') != 'arn:aws:iam::912390896286:role/WordMemoCloudFormation-' + TARGET_APP_ID
            or config.get('runtimeBoundaryArn') != 'arn:aws:iam::912390896286:policy/WordMemoRuntimeBoundary-' + TARGET_APP_ID):
        raise RuntimeError('Unexpected automation configuration. Publishing stopped.')
    return config


def stack_lookup(api, name):
    try:
        stacks = api('cloudformation', 'describe-stacks', {'StackName': name}).get('Stacks', [])
        return stacks[0] if stacks else None
    except RuntimeError as error:
        if 'does not exist' in str(error): return None
        raise


def google_setup(region, app_id, domain):
    import getpass
    import uuid
    import boto3
    print('\nGoogle requires one OAuth Web application in your Google Cloud project.')
    print('Google Cloud console: https://console.cloud.google.com/auth/clients')
    print('Authorized JavaScript origin: https://' + domain)
    print('Authorized redirect URI: https://' + domain + '/oauth2/idpresponse')
    print('App homepage: https://production.' + app_id + '.amplifyapp.com/')
    print('Privacy page: https://production.' + app_id + '.amplifyapp.com/privacy.html')
    print('Use External audience; publish the Google consent screen for friends outside your test users.')
    print('Enter the Google credentials below in CloudShell only. They are saved to AWS Secrets Manager, never the web app or this file.\n')
    client_id = input('Google OAuth client ID: ').strip()
    client_secret = getpass.getpass('Google OAuth client secret (hidden): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9._-]+\.apps\.googleusercontent\.com', client_id) or not 8 <= len(client_secret) <= 4096:
        raise RuntimeError('The Google OAuth credentials were incomplete. No Google secret was saved.')
    client = boto3.client('secretsmanager', region_name=region)
    try:
        response = client.create_secret(Name=f'wordmemo/google/{app_id}/{uuid.uuid4().hex}',
            Description='WordMemo Google OAuth provider; do not expose to browser clients',
            SecretString=json.dumps({'client_id': client_id, 'client_secret': client_secret}),
            Tags=[{'Key':k,'Value':v} for k,v in BACKEND_TAG.items()])
    except Exception:
        raise RuntimeError('Google credentials could not be saved in Secrets Manager. Check your AWS permissions and retry.') from None
    return response['ARN']


def ensure_backend(region, app_id, url, *, configure_google=False):
    if not BACKEND_TEMPLATE:
        raise RuntimeError('The backend template is missing. Use the newly generated deployment download.')
    api = lambda service, operation, data=None: aws_cli(region, service, operation, data)
    name = 'wordmemo-sync-' + app_id
    domain_prefix = 'wordmemo-' + EXPECTED_ACCOUNT + '-' + app_id
    stack = stack_lookup(api, name)
    if stack and not all(any(t.get('Key') == k and t.get('Value') == v for t in stack.get('Tags', [])) for k,v in BACKEND_TAG.items()):
        raise RuntimeError('An unrecognized backend stack already has this name. It was left unchanged.')
    if stack and stack.get('StackStatus', '').endswith('_IN_PROGRESS'):
        stack = wait_backend(api, name)
    if stack and stack.get('StackStatus') not in ('CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE','CREATE_FAILED','UPDATE_FAILED'):
        raise RuntimeError('The WordMemo backend needs attention in CloudFormation: ' + stack.get('StackStatus', 'unknown') + '. The existing public app was not replaced.')
    automation = automation_config(api)
    old_google = next((p['ParameterValue'] for p in (stack or {}).get('Parameters', []) if p['ParameterKey'] == 'GoogleSecretArn'), (automation or {}).get('googleSecretArn', ''))
    google_arn = google_setup(region, app_id, f'{domain_prefix}.auth.{region}.amazoncognito.com') if configure_google else old_google
    params = {'AppUrl':url, 'AppOrigin':url.rstrip('/'), 'DomainPrefix':domain_prefix, 'GoogleSecretArn':google_arn}
    previous_params = {p['ParameterKey']: p.get('ParameterValue', '') for p in (stack or {}).get('Parameters', [])}
    for key, field in [('ExternalUserPoolId', 'externalUserPoolId'), ('ExternalHttpApiId', 'externalHttpApiId'), ('RuntimeBoundaryArn', 'runtimeBoundaryArn'), ('ExternalProgressTableName', 'externalProgressTableName')]:
        params[key] = automation.get(field, '') if automation else previous_params.get(key, '')
    data = {'StackName':name, 'TemplateBody':json.dumps(BACKEND_TEMPLATE), 'Capabilities':['CAPABILITY_IAM'],
            'Parameters':[{'ParameterKey':k,'ParameterValue':v} for k,v in params.items()], 'Tags':[{'Key':k,'Value':v} for k,v in BACKEND_TAG.items()]}
    if automation:
        data['RoleARN'] = automation['cloudFormationRoleArn']
        # Preserve completed resources after errors so a fixed template can
        # update CREATE_FAILED/UPDATE_FAILED without deleting the stack.
        data['DisableRollback'] = True
    print('Setting up private accounts, saved progress, and life groups. AWS usage charges apply.', flush=True)
    # Validate syntax before creating/updating any stack resources.
    api('cloudformation','validate-template',{'TemplateBody':json.dumps(BACKEND_TEMPLATE)})
    try:
        api('cloudformation','update-stack' if stack else 'create-stack', data)
        stack = wait_backend(api, name)
    except RuntimeError as error:
        if 'No updates are to be performed' not in str(error): raise
        stack = stack_lookup(api, name)
    outputs = {o['OutputKey']:o['OutputValue'] for o in stack['Outputs']}
    config = {'enabled':True, 'region':region, 'userPoolId':outputs['UserPoolId'], 'clientId':outputs['ClientId'], 'domain':outputs['Domain'],
              'apiUrl':outputs['ApiUrl'], 'googleEnabled':outputs['GoogleEnabled'] == 'true', 'appUrl':url}
    if not re.fullmatch(r'https://[a-z0-9]+\.execute-api\.' + re.escape(region) + r'\.amazonaws\.com', config['apiUrl']):
        raise RuntimeError('The backend returned an unexpected API address. Publishing stopped.')
    (Path.cwd()/'WordMemo-backend.json').write_text(json.dumps(dict(config, stackName=name, tableName=outputs['TableName']),indent=2)+'\n')
    verify_backend(region, config, outputs['TableName'])
    return config


def wait_backend(api, name):
    deadline, previous = time.monotonic()+1800, ''
    while time.monotonic() < deadline:
        stack = stack_lookup(api, name)
        status = (stack or {}).get('StackStatus', 'UNKNOWN')
        if status != previous: print('AWS backend: ' + status, flush=True); previous = status
        if status in ('CREATE_COMPLETE','UPDATE_COMPLETE'): return stack
        if not status.endswith('_IN_PROGRESS'):
            events = api('cloudformation','describe-stack-events', {'StackName':name}).get('StackEvents', [])
            failures = [e for e in events if e.get('ResourceStatus', '').endswith('FAILED')]
            detail = next((e.get('ResourceStatusReason','') for e in failures), '')
            detail = re.sub(r'https?://\S+', '[URL omitted]', detail)
            raise RuntimeError(f'Backend setup stopped ({status}). {detail[:900]} The existing public app was not replaced.')
        time.sleep(5)
    raise RuntimeError('Backend setup is still running. Rerun this same deployment file to continue.')


def api_http(config, path, token=None, body=None, method='GET', expected=200):
    headers = {'Accept':'application/json', 'Cache-Control':'no-cache'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if body is not None: headers['Content-Type'] = 'application/json'
    request = Request(config['apiUrl']+path, headers=headers, method=method, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=35) as response: status, payload = response.status, response.read()
    except HTTPError as error: status, payload = error.code, error.read()
    if status != expected:
        raise RuntimeError(f'Backend verification failed: {method} {path.split("/")[1]} returned HTTP {status}, expected {expected}. The public app was not replaced.')
    return json.loads(payload or b'{}')


def verify_backend(region, config, table_name):
    """Two temporary accounts verify real authorization and storage before publish.

    Suppressed invitations: these synthetic users never receive emails. Cleanup
    is restricted to the exact temporary users and partitions created here.
    """
    import boto3
    import secrets
    import uuid
    print('Checking sign-in, private saving, group permissions, and shared practice...', flush=True)
    for attempt in range(12):
        try:
            api_http(config, '/health'); api_http(config, '/progress', expected=401); break
        except (RuntimeError, URLError):
            if attempt == 11: raise
            time.sleep(5)
    cognito, dynamo = boto3.client('cognito-idp', region_name=region), boto3.client('dynamodb', region_name=region)
    created, partitions = [], []
    def http(path, token=None, body=None, method='GET', expected=200): return api_http(config,path,token,body,method,expected)
    try:
        tokens, users = [], []
        for _ in range(2):
            email = 'wordmemo-check-'+uuid.uuid4().hex+'@example.invalid'
            result = cognito.admin_create_user(UserPoolId=config['userPoolId'], Username=email, MessageAction='SUPPRESS', UserAttributes=[{'Name':'email','Value':email},{'Name':'email_verified','Value':'true'}])
            username = result['User']['Username']; created.append(username)
            uid = next(a['Value'] for a in result['User']['Attributes'] if a['Name'] == 'sub'); users.append(uid); partitions.append('USER#'+uid)
            password = secrets.token_urlsafe(32)+'Aa7!'
            cognito.admin_set_user_password(UserPoolId=config['userPoolId'],Username=username,Password=password,Permanent=True)
            auth = cognito.initiate_auth(ClientId=config['clientId'],AuthFlow='USER_PASSWORD_AUTH',AuthParameters={'USERNAME':username,'PASSWORD':password})['AuthenticationResult']
            tokens.append(auth['AccessToken'])
            http('/progress',auth['IdToken'],expected=403)
        alice,bob = tokens
        state = {'version':1,'onboarded':True,'settings':{'dailyGoal':5,'newPerDay':5,'mode':'mixed','fontScale':1,'reminderTime':'08:00','reminderEnabled':False},'enrolled':['webp-psa-119-11-11'],'favorites':[],'history':[],'progress':{},'goalDays':[],'stacks':[]}
        http('/progress',alice,{'state':state,'revision':0},'PUT')
        if http('/progress',alice)['state'] != state or http('/progress',bob)['state'] is not None: raise RuntimeError('Account isolation check failed.')
        http('/progress',alice,{'state':state,'revision':0},'PUT',409)
        gid, sid, rid = uuid.uuid4().hex, uuid.uuid4().hex, uuid.uuid4().hex
        partitions.append('GROUP#'+gid)
        http('/groups',alice,{'id':gid,'name':'WordMemo deployment check','displayName':'Check A'},'POST')
        http('/groups/'+gid,bob,expected=403)
        invite = http('/groups/'+gid+'/invite',alice,{},'POST')
        partitions.append('INVITE#'+hashlib.sha256(invite['token'].encode()).hexdigest())
        http('/groups/join',bob,{'token':invite['token'],'displayName':'Check B'},'POST')
        group = http('/groups/'+gid,bob)
        if any('summary' in m for m in group['members']): raise RuntimeError('Default privacy check failed.')
        http('/groups/'+gid+'/membership',alice,{'displayName':'Check A','shareProgress':True},'PUT')
        if not any('summary' in m for m in http('/groups/'+gid,bob)['members']): raise RuntimeError('Progress sharing check failed.')
        http('/groups/'+gid+'/membership',alice,{'displayName':'Check A','shareProgress':False},'PUT')
        if any('summary' in m for m in http('/groups/'+gid,bob)['members']): raise RuntimeError('Progress opt-out check failed.')
        http('/groups/'+gid+'/stacks',alice,{'id':sid,'name':'Check stack','verseIds':state['enrolled']},'POST')
        http('/groups/'+gid+'/rooms',alice,{'id':rid,'stackId':sid,'direction':'reference'},'POST')
        path = '/groups/'+gid+'/rooms/'+rid
        http(path,bob,{'revision':1,'action':'reveal'},'PUT',403)
        http(path,alice,{'revision':1,'action':'reveal'},'PUT')
        http(path+'/answer',bob,{'index':0,'correct':True},'POST')
        http(path+'/answer',bob,{'index':0,'correct':True},'POST')
        if http(path,alice)['responses'] != 1: raise RuntimeError('Duplicate room response check failed.')
        http('/groups/'+gid+'/members/'+users[1],bob,method='DELETE')
        http('/groups/'+gid,bob,expected=403)
    finally:
        cleanup_failed = False
        for pk in partitions:
            try:
                start = None
                while True:
                    args = {'TableName':table_name,'KeyConditionExpression':'PK = :pk','ExpressionAttributeValues':{':pk':{'S':pk}},'ProjectionExpression':'PK, SK','ConsistentRead':True}
                    if start: args['ExclusiveStartKey'] = start
                    result = dynamo.query(**args)
                    for item in result.get('Items',[]): dynamo.delete_item(TableName=table_name,Key=item)
                    start = result.get('LastEvaluatedKey')
                    if not start: break
            except Exception: cleanup_failed = True
        for username in created:
            try: cognito.admin_delete_user(UserPoolId=config['userPoolId'],Username=username)
            except Exception: cleanup_failed = True
        if cleanup_failed:
            (Path.cwd()/'WordMemo-check-cleanup.json').write_text(json.dumps({'userPoolId':config['userPoolId'],'usernames':created,'tableName':table_name,'partitions':partitions},indent=2)+'\n')
            raise RuntimeError('Verification cleanup was incomplete. Temporary test identifiers are in WordMemo-check-cleanup.json. No real user records were targeted.')
    print('Backend checks passed; temporary test accounts and records removed.', flush=True)


def configure_archive(archive_data, config):
    from zipfile import ZIP_DEFLATED, ZipInfo
    with ZipFile(io.BytesIO(archive_data)) as archive:
        files = {name:archive.read(name) for name in archive.namelist()}
    files['wordmemo-config.json'] = (json.dumps(config,separators=(',',':'))+'\n').encode()
    paths = sorted(name for name in files if name not in ('sw.js','metadata.json','customHttp.yml') and not name.endswith('.map'))
    digest = hashlib.sha256(WORKER_TEMPLATE.encode())
    for path in paths: digest.update(path.encode()); digest.update(b'\0'); digest.update(files[path])
    worker = WORKER_TEMPLATE.replace('__BUILD_VERSION__',digest.hexdigest()[:16]).replace('__PRECACHE_URLS__',json.dumps(['/'+p for p in paths],separators=(',',':')))
    files['sw.js'] = worker.encode()
    output = io.BytesIO()
    with ZipFile(output,'w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
        for name in sorted(files):
            info = ZipInfo(name,date_time=(2026,9,12,0,0,0)); info.compress_type = ZIP_DEFLATED
            archive.writestr(info,files[name])
    return output.getvalue()
