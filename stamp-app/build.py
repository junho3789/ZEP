"""Run checks and build the stamp app upload archive."""
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = ('main.js', 'stamp-ui.html', 'stamp-mini.html')
DESTINATION = ROOT / 'zep-object-stamps-v1.5.2.zepapp.zip'


def main():
    subprocess.run(['node', '--check', str(ROOT / 'main.js')], check=True)
    subprocess.run(['node', str(ROOT / 'test.cjs')], check=True)
    with tempfile.TemporaryDirectory(prefix='zep-stamps-') as directory:
        for name in ('stamp-ui.html', 'stamp-mini.html'):
            html = (ROOT / name).read_text(encoding='utf-8')
            script = re.search(r'<script>(.*?)</script>', html, re.DOTALL).group(1)
            script_file = Path(directory) / (name + '.js')
            script_file.write_text(script, encoding='utf-8')
            subprocess.run(['node', '--check', str(script_file)], check=True)

    with zipfile.ZipFile(DESTINATION, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, name)
    with zipfile.ZipFile(DESTINATION) as archive:
        assert archive.testzip() is None
        assert tuple(archive.namelist()) == FILES
        for name in FILES:
            assert archive.read(name) == (ROOT / name).read_bytes()
    print(f'Verified: {DESTINATION}')


if __name__ == '__main__':
    main()
