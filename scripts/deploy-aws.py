#!/usr/bin/env python3
"""Deploy the bundled WordMemo web release using an existing AWS CLI session.

Designed for AWS CloudShell. No packages, credentials, or source checkout are
needed. The release builder appends the verified web archive to this script.
Default destination: AWS account 912390896286, us-west-2, Amplify Hosting.
Only a WordMemo app carrying this installer's tag is reused. AWS usage charges
apply. This upgrade creates Cognito, DynamoDB, Lambda, and API Gateway resources.
It never creates IAM users or access keys.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zipfile import ZipFile

EXPECTED_ACCOUNT = '912390896286'
APP_NAME = 'wordmemo'
BRANCH = 'production'
OWNER_TAG = {'WordMemoDeployment': 'wordmemo-public-web-v1'}
PAYLOAD_SHA256 = ''  # Filled by build-aws-installer.py.
PAYLOAD_B64 = ''


def archive_bytes():
    if not PAYLOAD_B64:
        raise RuntimeError('Use the generated WordMemo-deploy-aws.py download, which includes the app.')
    data = base64.b64decode(PAYLOAD_B64)
    if hashlib.sha256(data).hexdigest() != PAYLOAD_SHA256:
        raise RuntimeError('The app archive checksum does not match. Download the deployment file again.')
    with ZipFile(io.BytesIO(data)) as archive:
        for name in ['index.html', 'sw.js', 'manifest.webmanifest', 'customHttp.yml']:
            if name not in archive.namelist():
                raise RuntimeError(f'The app archive is missing {name}.')
        if archive.testzip() is not None:
            raise RuntimeError('The app archive is damaged.')
    return data


def aws_cli(region, service, operation, data=None):
    command = ['aws', service, operation, '--region', region, '--output', 'json',
               '--no-cli-pager', '--cli-connect-timeout', '15', '--cli-read-timeout', '60']
    if data is not None:
        command += ['--cli-input-json', json.dumps(data)]
    env = dict(os.environ, AWS_PAGER='', AWS_CLI_AUTO_PROMPT='off')
    result = subprocess.run(command, capture_output=True, text=True, env=env, timeout=120)
    if result.returncode:
        # Never include signed upload URLs in diagnostic output.
        detail = re.sub(r'https?://\S+', '[URL omitted]', result.stderr.strip())
        raise RuntimeError(f'AWS {operation} failed: {detail[:1400]}')
    return json.loads(result.stdout or '{}')


def choose_app(apps):
    matches = [app for app in apps if app.get('name') == APP_NAME
               and all(app.get('tags', {}).get(k) == v for k, v in OWNER_TAG.items())]
    if len(matches) > 1:
        raise RuntimeError('More than one matching WordMemo app exists. No app was changed.')
    app = matches[0] if matches else None
    if app and (app.get('repository') or app.get('platform') != 'WEB' or app.get('enableBasicAuth')):
        raise RuntimeError('The existing WordMemo app has a different hosting or access setup. No app was changed.')
    return app


def upload_archive(url, data):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.amazonaws.com'):
        raise RuntimeError('AWS returned an unexpected upload destination; upload was stopped.')
    request = Request(url, data=data, method='PUT', headers={'Content-Type': 'application/zip'})
    try:
        with urlopen(request, timeout=180) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError('AWS did not accept the app upload.')
    except HTTPError as error:
        raise RuntimeError(f'App upload failed with HTTP {error.code}. Rerun the file to request a fresh upload.') from None
    except URLError:
        raise RuntimeError('App upload could not reach AWS. Keep CloudShell connected and rerun the file.') from None


def verify_public_release(url, archive_data):
    with ZipFile(io.BytesIO(archive_data)) as archive:
        expected_html = archive.read('index.html')
        matches = re.findall(r'<script[^>]+src="([^"]+)"', expected_html.decode('utf-8'))
        paths = ['/index.html', '/sw.js', '/manifest.webmanifest', '/wordmemo-config.json', '/privacy.html'] + matches
        expected = {path: archive.read(path.lstrip('/')) for path in paths}
    for attempt in range(12):
        try:
            for path, content in expected.items():
                request = Request(url.rstrip('/') + path, headers={
                    'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity',
                })
                with urlopen(request, timeout=30) as response:
                    actual = response.read()
                    if response.status != 200 or hashlib.sha256(actual).digest() != hashlib.sha256(content).digest():
                        raise ValueError('The public edge is still updating.')
            # Check the actual share URL as well as the individual build files.
            with urlopen(Request(url, headers={'Accept-Encoding': 'identity'}), timeout=30) as response:
                if response.status != 200 or response.read() != expected_html:
                    raise ValueError('The public home page is still updating.')
            return True
        except (HTTPError, URLError, TimeoutError, ValueError):
            if attempt < 11:
                time.sleep(10)
    return False


def deploy(region, archive_data, *, verify_only=False, force_new=False, configure_google=False):
    api = lambda service, operation, data=None: aws_cli(region, service, operation, data)
    identity = api('sts', 'get-caller-identity')
    if identity.get('Account') != EXPECTED_ACCOUNT:
        raise RuntimeError(f'Wrong AWS account. Switch CloudShell to account {EXPECTED_ACCOUNT}; no resources were changed.')
    print(f'Confirmed AWS account {EXPECTED_ACCOUNT}, region {region}.', flush=True)
    with ZipFile(io.BytesIO(archive_data)) as archive:
        custom_headers = archive.read('customHttp.yml').decode('utf-8')
    try:
        app = choose_app([api('amplify', 'get-app', {'appId': TARGET_APP_ID})['app']])
    except RuntimeError as error:
        if 'NotFoundException' not in str(error): raise
        app = None
    if verify_only:
        print('Account and app package checks passed. No AWS resources were created or changed.')
        return
    if not app or app['appId'] != TARGET_APP_ID:
        raise RuntimeError('The existing WordMemo app was not found in this region. No new app was created; check us-west-2 and account 912390896286.')
    print('Publishing the public WordMemo app. AWS Amplify hosting usage charges apply.', flush=True)
    app_id = app['appId']
    # Retain only non-secret identifiers so rerunning can resume a known job.
    record_path = Path.cwd() / f'WordMemo-deployment-{region}.json'
    try:
        branch = api('amplify', 'get-branch', {'appId': app_id, 'branchName': BRANCH})['branch']
    except RuntimeError as error:
        if 'NotFoundException' not in str(error): raise
        branch = None
    if branch and (branch.get('enableBasicAuth') or branch.get('enableAutoBuild')):
        raise RuntimeError('The production branch has a different access/build setup. It was left unchanged.')
    if branch is None:
        api('amplify', 'create-branch', {
            'appId': app_id, 'branchName': BRANCH, 'stage': 'PRODUCTION',
            'enableAutoBuild': False, 'enableBasicAuth': False,
            'enablePerformanceMode': False, 'tags': OWNER_TAG,
        })
    domain = app['defaultDomain']
    if not re.fullmatch(r'[a-z0-9-]+\.amplifyapp\.com', domain):
        raise RuntimeError('Unexpected Amplify default domain. Check the app in the AWS console.')
    url = f'https://{BRANCH}.{domain}/'
    config = ensure_backend(region, app_id, url, configure_google=configure_google)
    archive_data = configure_archive(archive_data, config)
    archive_hash = hashlib.sha256(archive_data).hexdigest()
    api('amplify', 'update-app', {'appId': app_id, 'customHeaders': custom_headers})
    record = None
    if record_path.exists() and not force_new:
        try:
            candidate = json.loads(record_path.read_text())
            if (candidate.get('appId') == app_id and candidate.get('account') == EXPECTED_ACCOUNT
                    and candidate.get('archiveSha256') == archive_hash and candidate.get('started')):
                record = candidate
        except (ValueError, OSError):
            pass
    if record is None:
        print('Uploading the complete Bible app...', flush=True)
        pending = api('amplify', 'create-deployment', {'appId': app_id, 'branchName': BRANCH})
        upload_archive(pending['zipUploadUrl'], archive_data)
        record = {'account': EXPECTED_ACCOUNT, 'region': region, 'appId': app_id,
                  'branch': BRANCH, 'jobId': pending['jobId'], 'url': url,
                  'archiveSha256': archive_hash, 'started': True}
        # Record the intended job before starting: if that API call times out,
        # the next run checks its real status instead of submitting a duplicate.
        record_path.write_text(json.dumps(record, indent=2) + '\n')
        api('amplify', 'start-deployment', {'appId': app_id, 'branchName': BRANCH, 'jobId': record['jobId']})
    else:
        print('Resuming the saved WordMemo deployment...', flush=True)
    print('Waiting for AWS to publish...', flush=True)
    deadline = time.monotonic() + 1200
    last_status = None
    while time.monotonic() < deadline:
        job = api('amplify', 'get-job', {'appId': app_id, 'branchName': BRANCH, 'jobId': record['jobId']})['job']
        status = job['summary']['status']
        if status != last_status:
            print(f'AWS deployment: {status}', flush=True)
            last_status = status
        if status == 'SUCCEED':
            break
        if status in ('FAILED', 'CANCELLED'):
            raise RuntimeError(f'AWS deployment {status.lower()}. Check the WordMemo job in Amplify; rerun with --new-deployment after resolving the cause.')
        if status == 'CREATED':
            # Recovery after interruption before start-deployment completed.
            api('amplify', 'start-deployment', {'appId': app_id, 'branchName': BRANCH, 'jobId': record['jobId']})
        time.sleep(5)
    else:
        raise RuntimeError('AWS is still deploying. Rerun this same file to resume checking the saved deployment.')
    print('Checking the public link without an AWS login...', flush=True)
    if not verify_public_release(url, archive_data):
        print(f'AWS reports success, but public verification is not complete. Candidate URL: {url}')
        raise RuntimeError('The public files have not all matched yet. Rerun the same file to verify the saved deployment.')
    record['verified'] = True
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    print(f'\nWordMemo is live and its public files are verified:\n{url}\n\nShare that link with your friends.', flush=True)


def main():
    parser = argparse.ArgumentParser(description='Deploy the complete WordMemo web app to AWS Amplify.')
    parser.add_argument('--region', default='us-west-2', help='AWS region (default: us-west-2 / Oregon)')
    parser.add_argument('--verify-package', action='store_true', help='Validate the embedded app without accessing AWS')
    parser.add_argument('--check-access', action='store_true', help='Read-only AWS account and package validation')
    parser.add_argument('--configure-google', action='store_true', help='Securely connect Google OAuth credentials in CloudShell')
    parser.add_argument('--new-deployment', action='store_true', help='Create a new job instead of resuming a recorded job')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z]{2}-[a-z]+-\d', args.region):
        raise RuntimeError('Use a standard AWS region, such as us-west-2.')
    data = archive_bytes()
    if args.verify_package:
        print(f'Embedded WordMemo package verified: {len(data):,} bytes. No AWS calls made.')
        return
    if not shutil.which('aws'):
        raise RuntimeError('Run this file in AWS CloudShell, which already includes the AWS CLI.')
    deploy(args.region, data, verify_only=args.check_access, force_new=args.new_deployment, configure_google=args.configure_google)


# BACKEND_HELPERS_HERE

# BUILD_PAYLOAD_HERE

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped waiting. AWS may still finish; rerun the same file to resume checking.', file=sys.stderr)
        sys.exit(1)
    except (RuntimeError, subprocess.TimeoutExpired, TimeoutError, OSError) as error:
        message = re.sub(r'https?://\S+\?\S+', '[signed URL omitted]', str(error))
        print(f'\n{message}', file=sys.stderr)
        sys.exit(1)
