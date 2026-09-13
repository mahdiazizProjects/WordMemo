"""Package build contents at ZIP root for AWS Amplify manual deployment."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
build = root / 'dist-web'
output = root / 'release' / 'WordMemo-AWS-web.zip'
required = ['index.html', 'sw.js', 'manifest.webmanifest', 'customHttp.yml']
for filename in required:
    if not (build / filename).is_file():
        raise SystemExit(f'Missing {filename}. Run npm run export:web first.')
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(build.rglob('*')):
        if file.is_file() and file.suffix != '.map' and file.name != 'metadata.json':
            archive.write(file, file.relative_to(build).as_posix())
with ZipFile(output) as archive:
    assert all(name in archive.namelist() for name in required)
    assert archive.testzip() is None
print(f'{output} ({output.stat().st_size / 1024 / 1024:.2f} MiB)')
