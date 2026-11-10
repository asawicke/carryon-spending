"""Create an Azure source ZIP from an explicit allowlist, excluding local data/secrets."""
import argparse
import json
import stat
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def write_public_file(archive, name, content):
    # writestr defaults to 0600. Azure builds and runs as different users, so
    # deployed source/config must remain readable by the runtime user.
    entry = ZipInfo(name)
    entry.create_system = 3
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    entry.compress_type = ZIP_DEFLATED
    archive.writestr(entry, content)


def package(destination, frontend_dist=None):
    dist = Path(frontend_dist) if frontend_dist else ROOT / 'frontend/dist'
    if not (dist / 'index.html').is_file():
        raise RuntimeError('Build the frontend before packaging the deployment.')
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    files = [(ROOT / name, name) for name in ('requirements.txt', 'wsgi.py', 'function_app.py', 'host.json', 'gunicorn.conf.py', 'startup.sh')]
    files += [(p, str(p.relative_to(ROOT))) for p in (ROOT / 'backend').glob('*.py')]
    files += [(ROOT / 'backend/requirements.txt', 'backend/requirements.txt')]
    files += [(p, str(p.relative_to(ROOT))) for p in (ROOT / 'backend/resources').glob('*.json')]
    files += [(p, 'frontend/dist/' + str(p.relative_to(dist))) for p in dist.rglob('*') if p.is_file()]
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for source, name in sorted(files, key=lambda pair: pair[1]):
            if '.env' in Path(name).parts or any(part in ('data', 'tests', '__pycache__', '.git') for part in Path(name).parts):
                raise RuntimeError('Unexpected private file in deployment allowlist.')
            write_public_file(archive, name, source.read_bytes())
        write_public_file(archive, 'deployment-manifest.json', json.dumps({'format': 1, 'files': [name for _, name in files]}, indent=2))
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination')
    parser.add_argument('--frontend-dist')
    arguments = parser.parse_args()
    print(package(arguments.destination, arguments.frontend_dist))
