"""Exercise AWS deployment control flow without credentials or network calls."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('wordmemo_deploy', Path(__file__).resolve().parents[1] / 'scripts/deploy-aws.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
exec((Path(__file__).resolve().parents[1] / 'scripts/backend-deploy.inc.py').read_text(), deploy.__dict__)


def archive():
    data = io.BytesIO()
    with ZipFile(data, 'w') as zipped:
        zipped.writestr('index.html', '<title>WordMemo</title><script src="/app.js"></script>')
        zipped.writestr('app.js', '/* app */')
        zipped.writestr('sw.js', '/* worker */')
        zipped.writestr('manifest.webmanifest', '{}')
        zipped.writestr('customHttp.yml', 'customHeaders: []')
        zipped.writestr('wordmemo-config.json', '{"enabled":false}')
        zipped.writestr('privacy.html', '<title>Privacy</title>')
    return data.getvalue()


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.data = archive()
        self.app = {'name': 'wordmemo', 'appId': deploy.TARGET_APP_ID, 'tags': deploy.OWNER_TAG,
                    'platform': 'WEB', 'defaultDomain': deploy.TARGET_APP_ID + '.amplifyapp.com', 'enableBasicAuth': False}

    def test_wrong_account_stops_before_any_amplify_action(self):
        with patch.object(deploy, 'aws_cli', return_value={'Account': '000000000000'}) as api:
            with self.assertRaisesRegex(RuntimeError, 'Wrong AWS account'):
                deploy.deploy('us-west-2', self.data)
            self.assertEqual(api.call_count, 1)
            self.assertEqual(api.call_args.args[1:3], ('sts', 'get-caller-identity'))

    def test_unrelated_same_name_app_is_never_selected(self):
        self.assertIsNone(deploy.choose_app([{**self.app, 'tags': {}}]))
        with self.assertRaisesRegex(RuntimeError, 'More than one'):
            deploy.choose_app([self.app, self.app])
        with self.assertRaisesRegex(RuntimeError, 'different hosting'):
            deploy.choose_app([{**self.app, 'repository': 'https://example.com/repository'}])

    def test_package_checksum_rejects_changes(self):
        with patch.object(deploy, 'PAYLOAD_B64', base64.b64encode(self.data).decode()), patch.object(deploy, 'PAYLOAD_SHA256', 'wrong'):
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                deploy.archive_bytes()

    def test_upload_rejects_non_aws_destination_before_sending(self):
        with patch.object(deploy, 'urlopen') as upload:
            with self.assertRaisesRegex(RuntimeError, 'unexpected upload'):
                deploy.upload_archive('https://example.com/upload', self.data)
            upload.assert_not_called()

    def test_check_access_is_read_only(self):
        calls = []
        def api(region, service, operation, data=None):
            calls.append(operation)
            return {'Account': deploy.EXPECTED_ACCOUNT} if operation == 'get-caller-identity' else {'app': {}}
        with patch.object(deploy, 'aws_cli', side_effect=api), contextlib.redirect_stdout(io.StringIO()):
            deploy.deploy('us-west-2', self.data, verify_only=True)
        self.assertEqual(calls, ['get-caller-identity', 'get-app'])

    def test_new_deployment_then_rerun_reuses_same_successful_job(self):
        calls = []
        already_created = True
        def api(region, service, operation, data=None):
            nonlocal already_created
            calls.append(operation)
            if operation == 'get-caller-identity': return {'Account': deploy.EXPECTED_ACCOUNT}
            if operation == 'get-app': return {'app': self.app}
            if operation == 'create-app':
                already_created = True
                self.assertFalse(data['enableBasicAuth'])
                self.assertEqual(data['platform'], 'WEB')
                return {'app': self.app}
            if operation == 'update-app': return {'app': self.app}
            if operation == 'list-branches': return {'branches': [{'branchName': 'production'}]}
            if operation == 'create-deployment': return {'jobId': '7', 'zipUploadUrl': 'https://s3.us-west-2.amazonaws.com/upload?signature=private'}
            if operation == 'start-deployment': return {'jobSummary': {'jobId': '7', 'status': 'PENDING'}}
            if operation == 'get-job': return {'job': {'summary': {'status': 'SUCCEED'}, 'steps': []}}
            raise AssertionError(operation)
        with tempfile.TemporaryDirectory() as temp, patch.object(deploy.Path, 'cwd', return_value=Path(temp)), \
                patch.object(deploy, 'aws_cli', side_effect=api), patch.object(deploy, 'upload_archive') as upload, \
                patch.object(deploy, 'verify_public_release', return_value=True), patch.object(deploy, 'ensure_backend', return_value={}), patch.object(deploy, 'configure_archive', side_effect=lambda data, config:data), contextlib.redirect_stdout(io.StringIO()) as output:
            deploy.deploy('us-west-2', self.data)
            record = json.loads((Path(temp) / 'WordMemo-deployment-us-west-2.json').read_text())
            self.assertTrue(record['verified'])
            self.assertNotIn('signature', json.dumps(record))
            deploy.deploy('us-west-2', self.data)
            upload.assert_called_once()
            self.assertEqual(calls.count('create-app'), 0)
            self.assertEqual(calls.count('create-deployment'), 1)
            self.assertEqual(calls.count('start-deployment'), 1)
            self.assertNotIn('signature', output.getvalue())
            self.assertIn('https://production.d3p8fj75zj86rx.amplifyapp.com/', output.getvalue())

    def test_public_verification_requires_exact_release_files_without_auth_headers(self):
        with ZipFile(io.BytesIO(self.data)) as zipped:
            content = {'/' + name: zipped.read(name) for name in zipped.namelist()}
        content['/'] = content['/index.html']
        def fetch(request, timeout):
            self.assertNotIn('Authorization', request.headers)
            body = content[deploy.urlparse(request.full_url).path]
            result = io.BytesIO(body)
            result.status = 200
            return result
        with patch.object(deploy, 'urlopen', side_effect=fetch):
            self.assertTrue(deploy.verify_public_release('https://production.d3p8fj75zj86rx.amplifyapp.com/', self.data))
        content['/app.js'] = b'old-release'
        with patch.object(deploy, 'urlopen', side_effect=fetch), patch.object(deploy.time, 'sleep'):
            self.assertFalse(deploy.verify_public_release('https://production.d3p8fj75zj86rx.amplifyapp.com/', self.data))


    def test_missing_existing_app_never_creates_a_replacement_or_backend(self):
        def aws(region, service, operation, data=None):
            return {'Account': deploy.EXPECTED_ACCOUNT} if operation == 'get-caller-identity' else {'app': {}}
        with patch.object(deploy, 'aws_cli', side_effect=aws), patch.object(deploy, 'ensure_backend') as backend:
            with self.assertRaisesRegex(RuntimeError, 'No new app was created'):
                deploy.deploy('us-west-2', self.data)
            backend.assert_not_called()

    def test_backend_failure_never_publishes_frontend(self):
        calls=[]
        def aws(region, service, operation, data=None):
            calls.append(operation)
            if operation == 'get-caller-identity': return {'Account': deploy.EXPECTED_ACCOUNT}
            if operation == 'get-app': return {'app':self.app}
            if operation == 'list-branches': return {'branches':[{'branchName':'production'}]}
            raise AssertionError(operation)
        with tempfile.TemporaryDirectory() as temp, patch.object(deploy.Path,'cwd',return_value=Path(temp)), patch.object(deploy,'aws_cli',side_effect=aws), patch.object(deploy,'ensure_backend',side_effect=RuntimeError('Backend failed')):
            with self.assertRaisesRegex(RuntimeError,'Backend failed'): deploy.deploy('us-west-2',self.data)
        self.assertNotIn('create-deployment',calls); self.assertNotIn('update-app',calls)

    def test_runtime_config_changes_worker_version_and_archive_is_reproducible(self):
        template = (Path(__file__).resolve().parents[1]/'scripts/service-worker.js').read_text()
        with patch.object(deploy,'WORKER_TEMPLATE',template):
            first=deploy.configure_archive(self.data,{'enabled':True,'clientId':'one'})
            again=deploy.configure_archive(self.data,{'enabled':True,'clientId':'one'})
            second=deploy.configure_archive(self.data,{'enabled':True,'clientId':'two'})
        self.assertEqual(first,again); self.assertNotEqual(first,second)
        with ZipFile(io.BytesIO(first)) as a, ZipFile(io.BytesIO(second)) as b:
            self.assertNotEqual(a.read('sw.js'),b.read('sw.js'))
            self.assertEqual(json.loads(a.read('wordmemo-config.json'))['clientId'],'one')
            self.assertNotIn(b'__BUILD_VERSION__',a.read('sw.js'))


if __name__ == '__main__':
    unittest.main()
