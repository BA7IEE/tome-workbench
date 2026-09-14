"""Verify a delivered source ZIP, then install/build it in a fresh temporary directory.
No .env, credentials or database data is copied; no database is contacted.
"""
from pathlib import Path, PurePosixPath
import hashlib, json, os, subprocess, sys, tempfile, time, zipfile
archive = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parent.parent
report = {"kind": "clean-archive-install-and-build", "passed": False, "steps": {}, "databaseActions": 0}
report["testedArchiveSha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
reports = root / "reports"
reports.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="tome-clean-install-") as temp:
    target = Path(temp)
    try:
        with zipfile.ZipFile(archive) as z:
            if sum(i.file_size for i in z.infolist()) > 100 * 1024 * 1024:
                raise ValueError("Unexpected source archive size")
            for i in z.infolist():
                p = PurePosixPath(i.filename)
                if p.is_absolute() or ".." in p.parts or p.parts[0] != "tome-workbench":
                    raise ValueError("Unsafe archive path")
                if (i.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Symlink in source archive")
            z.extractall(target)
        app = target / "tome-workbench"
        manifest = json.loads((app / "SHA256-MANIFEST.json").read_text())
        for name, digest in manifest["files"].items():
            if hashlib.sha256((app / name).read_bytes()).hexdigest() != digest:
                raise ValueError("Archive checksum mismatch: " + name)
        actual_files = {p.relative_to(app).as_posix() for p in app.rglob("*") if p.is_file()}
        if actual_files != set(manifest["files"]) | {"SHA256-MANIFEST.json"}:
            raise ValueError("Archive contains unlisted files")
        report["sourceSha256"] = manifest["sourceSha256"]
        report["steps"]["manifestIntegrity"] = True
        env = dict(os.environ)
        env.update(DATABASE_URL="postgresql://unused:unused@127.0.0.1/tome_build", APP_ENV="test", EXTERNAL_EFFECTS_ENABLED="false")
        npm = "npm.cmd" if os.name == "nt" else "npm"
        commands = [("npmCi", [npm, "ci", "--no-fund"])]
        commands += [(s, [npm, "run", s]) for s in ["db:generate", "typecheck", "lint", "build", "test:unit", "harness:check"]]
        with (reports / "clean-archive.log").open("w") as log:
            for name, command in commands:
                result = subprocess.run(command, cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=300)
                report["steps"][name] = result.returncode == 0
                if result.returncode != 0:
                    raise RuntimeError("Clean source stage failed: " + name)
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        report["atUnixSeconds"] = int(time.time())
        (reports / "clean-archive.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False, indent=2))
if not report["passed"]:
    sys.exit(1)
