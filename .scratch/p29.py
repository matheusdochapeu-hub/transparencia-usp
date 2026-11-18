import subprocess, tempfile, os, shutil, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

url = "https://doe.sp.gov.br/executivo/universidade-de-sao-paulo/portaria-gr-n-8448-de-4-de-junho-de-2024-20240604114211214357603"
base = os.path.join(r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp", "data", "doe")
variants = [
    ["--headless=old"],
    ["--headless"],
    ["--headless=new", "--disable-features=Crashpad"],
    ["--headless=old", "--disable-breakpad", "--no-crashpad"],
]
for extra in variants:
    tmp = tempfile.mkdtemp(prefix="chr-", dir=base)
    cmd = [ex.chrome_bin(), "--disable-gpu", "--no-first-run", "--disable-extensions", *extra,
           f"--user-data-dir={tmp}", "--virtual-time-budget=15000", "--dump-dom", url]
    try:
        o = subprocess.run(cmd, capture_output=True, text=True, timeout=90, encoding="utf-8", errors="replace")
        print(extra, "rc", o.returncode, "len", len(o.stdout or ""), "err", (o.stderr or "").strip().splitlines()[-1][:120] if o.stderr else "")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
