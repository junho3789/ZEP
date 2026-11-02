"""Build an offline local packager and an explicitly labelled sample ZIP."""
import base64
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as output:
        for name, payload in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, payload)
    with zipfile.ZipFile(buffer) as check:
        assert check.namelist() == list(files)
        assert check.testzip() is None
        for name, payload in files.items():
            assert check.read(name) == payload
    return buffer.getvalue()


def main():
    subprocess.run(['node', '--test', str(ROOT / 'tests/offline.test.cjs'), str(ROOT / 'tests/zip.test.cjs')], check=True)
    config = (ROOT / 'zep/config.js').read_text()
    runtime = '\n'.join((ROOT / 'zep' / name).read_text() for name in ['controller.js', 'dialogue.js', 'app.js'])
    source = config + '\n' + runtime
    subprocess.run(['node', '--check', '-'], input=source, text=True, check=True)
    # The delivered runtime and widgets must have zero external request paths.
    widgets = {name: (ROOT / 'zep' / name).read_bytes() for name in ['chat.html', 'editor.html']}
    for text in [source] + [v.decode() for v in widgets.values()]:
        assert not re.search(r'\b(httpPost(?:Json)?|httpGet|fetch|XMLHttpRequest|WebSocket|OPENAI_API_KEY)\b', text)
    for widget in widgets.values():
        for script in re.findall(r'<script>(.*?)</script>', widget.decode(), re.S):
            subprocess.run(['node', '--check', '-'], input=script, text=True, check=True)
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    # This is a preview, explicitly not the inaccessible chat attachment.
    (dist / 'zep-npc-offline-v2.0.3-sample.zip').write_bytes(archive({
        'main.js': source.encode(), **widgets, 'npc.png': (ROOT / 'zep/npc.png').read_bytes()
    }))
    encode = lambda data: base64.b64encode(data).decode()
    payload = {'config': encode(config.encode()), 'runtime': encode(runtime.encode()),
               'chat': encode(widgets['chat.html']), 'editor': encode(widgets['editor.html'])}
    builder = (ROOT / 'tools/builder.template.html').read_text()
    builder = builder.replace('/* PACKAGE_DATA */', 'const ZEP_PACKAGE = ' + json.dumps(payload) + ';')
    builder = builder.replace('/* ZIP_WRITER */', (ROOT / 'tools/zip.js').read_text())
    for script in re.findall(r'<script>(.*?)</script>', builder, re.S):
        subprocess.run(['node', '--check', '-'], input=script, text=True, check=True)
    (dist / 'zep-npc-offline-builder.html').write_text(builder)
    # Browser-ready HTML must be opened after download, not GitHub's raw text view.
    builder_archive = archive({'zep-npc-offline-builder.html': builder.encode()})
    (dist / 'zep-npc-offline-builder.zip').write_bytes(builder_archive)
    (dist / 'zep-npc-offline-builder-v2.0.3.zip').write_bytes(builder_archive)
    print('Built: offline builder ZIP/HTML and clearly labelled sample ZIP')


if __name__ == '__main__':
    main()
