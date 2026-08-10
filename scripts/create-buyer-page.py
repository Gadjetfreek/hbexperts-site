#!/usr/bin/env python3
"""Create an encrypted HBE buyer decision page payload.

Requires: pip install cryptography
Usage: python scripts/create-buyer-page.py config.json 'buyer-password' buyer-slug
"""
import base64,json,os,shutil,sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

if len(sys.argv)!=4:
    raise SystemExit("Usage: create-buyer-page.py CONFIG_JSON PASSWORD BUYER_SLUG")
config_path,password,slug=sys.argv[1:]
if len(password)<12: raise SystemExit("Use a password of at least 12 characters.")
if not slug.replace('-','').isalnum(): raise SystemExit("Slug may contain letters, numbers, and hyphens only.")
root=Path(__file__).resolve().parents[1]
out=root/'static'/'buyers'/slug
if out.exists(): raise SystemExit(f"Buyer page already exists: {out}")
out.mkdir(parents=True)
raw=Path(config_path).read_bytes();json.loads(raw)
salt=os.urandom(16);iv=os.urandom(12)
kdf=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=250000)
key=kdf.derive(password.encode())
data=AESGCM(key).encrypt(iv,raw,None)
payload={"v":1,"kdf":"PBKDF2-SHA256","iterations":250000,"salt":base64.b64encode(salt).decode(),"iv":base64.b64encode(iv).decode(),"data":base64.b64encode(data).decode()}
(out/'client.enc.json').write_text(json.dumps(payload,separators=(',',':')))
shutil.copyfile(root/'static'/'buyer-portal'/'index-template.html',out/'index.html')
print(f"Created {out.relative_to(root)}")
print("Keep the password outside GitHub and share it with the buyer separately from the page URL.")
