import os, sys, re, glob
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

txt = sorted(glob.glob(os.path.join(ROOT, "data", "doe", "cache", "txt", "*.txt")), key=os.path.getmtime)[-1]
t = open(txt, encoding="utf-8").read()
print(txt, len(t))
i = t.lower().find("emprego")
while i >= 0 and i < len(t):
    print("\n--- trecho ---")
    print(re.sub(r"\s+", " ", t[max(0, i - 600):i + 900]))
    i = t.lower().find("emprego", i + 900)
    if i > 20000:
        break
