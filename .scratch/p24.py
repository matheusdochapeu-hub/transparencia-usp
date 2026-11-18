import os, subprocess, sys, tempfile, shutil
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

url = "https://doe.sp.gov.br/executivo/universidade-de-sao-paulo/portaria-gr-n-8448-de-4-de-junho-de-2024-20240604114211214357603"
tmp = tempfile.mkdtemp(prefix="chr-")
cmd = [ex.chrome_bin(), "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
       "--no-sandbox", f"--user-data-dir={tmp}", "--virtual-time-budget=20000", "--dump-dom", url]
try:
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
    print("returncode:", out.returncode)
    print("stdout len:", len(out.stdout or ""))
    print("stderr:", (out.stderr or "")[:1500])
    print("stdout head:", (out.stdout or "")[:300])
finally:
    shutil.rmtree(tmp, ignore_errors=True)
