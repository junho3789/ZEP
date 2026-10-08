"""Create a repeatable ZEP upload archive without overwriting different files."""
import argparse
import io
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def archive(source):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as output:
        entry = zipfile.ZipInfo("main.js", date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        output.writestr(entry, source)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/zep-coins.zepapp.zip")
    args = parser.parse_args()
    subprocess.run(["node", "--check", str(ROOT / "main.js")], check=True)
    subprocess.run(["node", "--test", str(ROOT / "tests/coins.test.js")], check=True)
    payload = archive((ROOT / "main.js").read_bytes())
    destination = args.output.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_bytes() != payload:
            parser.error("Existing ZIP differs; preserve it and choose another --output path.")
    else:
        with destination.open("xb") as output:
            output.write(payload)
    with zipfile.ZipFile(destination) as output:
        assert output.namelist() == ["main.js"]
        assert output.testzip() is None
        assert output.read("main.js") == (ROOT / "main.js").read_bytes()
    print(f"Verified ZEP upload ZIP: {destination}")


if __name__ == "__main__":
    main()
