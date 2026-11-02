"""Build a ZEP upload ZIP without credentials or backend source."""
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def build():
    source = '\n'.join((ROOT / 'zep' / name).read_text() for name in ['config.js', 'controller.js', 'app.js'])
    subprocess.run(['node', '--check', '-'], input=source, text=True, check=True)
    resources = {'main.js': source.encode(), 'chat.html': (ROOT / 'zep/chat.html').read_bytes(),
                 'npc.png': (ROOT / 'zep/npc.png').read_bytes()}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as output:
        for name, payload in resources.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, payload)
    with zipfile.ZipFile(buffer) as check:
        assert check.namelist() == list(resources)
        assert check.testzip() is None
        for name, payload in resources.items():
            assert check.read(name) == payload
    destination = ROOT / 'dist/zep-ai-npc-v1.0.0.zip'
    destination.parent.mkdir(exist_ok=True)
    destination.write_bytes(buffer.getvalue())
    print(json.dumps({'archive': str(destination), 'entries': list(resources)}))


if __name__ == '__main__':
    build()
