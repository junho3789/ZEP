from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
ROOT = Path(__file__).resolve().parent
subprocess.run(['node', '--check', str(ROOT / 'main.js')], check=True)
subprocess.run(['node', str(ROOT / 'test.cjs')], check=True)
with tempfile.TemporaryDirectory() as tmp:
    for name in ('wishlist.html', 'wishlist-mini.html'):
        script = Path(tmp) / (name + '.js')
        script.write_text(re.search(r'<script>(.*?)</script>', (ROOT / name).read_text(), re.S).group(1))
        subprocess.run(['node', '--check', str(script)], check=True)
out = ROOT.parent / 'dist' / 'zep-booth-wishlist-v2.1.zepapp.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('main.js', 'wishlist.html', 'wishlist-mini.html'):
        z.write(ROOT / name, name)
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert z.namelist() == ['main.js', 'wishlist.html', 'wishlist-mini.html']
    for name in z.namelist():
        assert z.read(name) == (ROOT / name).read_bytes()
print(out)
