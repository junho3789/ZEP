"""Create a repeatable ZEP upload archive without overwriting different files."""
import argparse
import io
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def archive(source, resources=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as output:
        files = {"main.js": source}
        files.update(resources or {})
        for name, contents in files.items():
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, contents)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entry", choices=["main.js", "tools/interaction-probe.js"], default="main.js")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = ROOT / args.entry
    probe = args.entry == "tools/interaction-probe.js"
    test_file = "interaction-probe.test.js" if probe else "coins.test.js"
    subprocess.run(["node", "--check", str(source)], check=True)
    subprocess.run(["node", "--test", str(ROOT / "tests" / test_file)], check=True)
    resources = {} if probe else {"coin-hud.html": (ROOT / "coin-hud.html").read_bytes()}
    if not probe:
        subprocess.run(["node", "--test", str(ROOT / "tests/voting.test.js")], check=True)
        subprocess.run(["node", "--test", str(ROOT / "tests/hud.test.js")], check=True)
    payload = archive(source.read_bytes(), resources)
    default_name = "zep-interaction-probe-chat.zepapp.zip" if probe else "zep-voting-coins.zepapp.zip"
    destination = (args.output or ROOT / "dist" / default_name).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_bytes() != payload:
            parser.error("Existing ZIP differs; preserve it and choose another --output path.")
    else:
        with destination.open("xb") as output:
            output.write(payload)
    with zipfile.ZipFile(destination) as output:
        assert output.namelist() == ["main.js"] + list(resources)
        for name, contents in resources.items():
            assert output.read(name) == contents
        assert output.testzip() is None
        assert output.read("main.js") == source.read_bytes()
    print(f"Verified ZEP upload ZIP: {destination}")


if __name__ == "__main__":
    main()
