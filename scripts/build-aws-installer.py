"""Create one CloudShell-ready file containing the verified WordMemo web app."""
from pathlib import Path
import base64
import hashlib
import textwrap

root = Path(__file__).resolve().parents[1]
archive = (root / 'release/WordMemo-AWS-web.zip').read_bytes()
template = (root / 'scripts/deploy-aws.py').read_text()
helpers = (root / 'scripts/backend-deploy.inc.py').read_text()
backend = (root / 'backend/template.json').read_text()
worker = (root / 'scripts/service-worker.js').read_text()
helpers = helpers.replace('BACKEND_TEMPLATE = {}  # Filled by the release builder.', 'BACKEND_TEMPLATE = json.loads(' + repr(backend) + ')').replace("WORKER_TEMPLATE = ''", 'WORKER_TEMPLATE = ' + repr(worker))
template = template.replace('# BACKEND_HELPERS_HERE', helpers)
digest = hashlib.sha256(archive).hexdigest()
encoded = '\n'.join(textwrap.wrap(base64.b64encode(archive).decode('ascii'), 100))
payload = f'PAYLOAD_SHA256 = {digest!r}\nPAYLOAD_B64 = """\n{encoded}\n"""'
output = root / 'release/WordMemo-deploy-aws.py'
output.write_text(template.replace('# BUILD_PAYLOAD_HERE', payload))
compile(output.read_text(), str(output), 'exec')
print(f'{output} ({output.stat().st_size:,} bytes)')
