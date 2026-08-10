#!/usr/bin/env python3
"""Create an encrypted HBE buyer decision page and HomeSearch route.

Requires: pip install cryptography
Usage: python scripts/create-buyer-page.py config.json 'buyer-password' buyer-slug homesearch-name

Optional attentionPhotos entries in config may use a local `file` path. The generator embeds those images as data URLs inside the encrypted payload so they are not published as separate image files.
"""
import base64,hashlib,json,mimetypes,os,shutil,sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

if len(sys.argv)!=5: raise SystemExit("Usage: create-buyer-page.py CONFIG_JSON PASSWORD BUYER_SLUG HOMESEARCH_NAME")
config_path,password,slug,homesearch=sys.argv[1:]
if len(password)<12: raise SystemExit("Use a password of at least 12 characters.")
if not slug.replace('-','').isalnum(): raise SystemExit("Slug may contain letters, numbers, and hyphens only.")
root=Path(__file__).resolve().parents[1];out=root/'static'/'buyers'/slug
if out.exists(): raise SystemExit(f"Buyer page already exists: {out}")
cfg=json.loads(Path(config_path).read_text());base=Path(config_path).resolve().parent
for photo in cfg.get('attentionPhotos',[]):
    file=photo.pop('file',None)
    if file:
        p=(base/file).resolve();mime=mimetypes.guess_type(p.name)[0] or 'image/jpeg'
        photo['data']=f"data:{mime};base64,"+base64.b64encode(p.read_bytes()).decode()
raw=json.dumps(cfg,separators=(',',':')).encode();salt=os.urandom(16);iv=os.urandom(12)
kdf=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=250000);key=kdf.derive(password.encode());data=AESGCM(key).encrypt(iv,raw,None)
payload={"v":1,"kdf":"PBKDF2-SHA256","iterations":250000,"salt":base64.b64encode(salt).decode(),"iv":base64.b64encode(iv).decode(),"data":base64.b64encode(data).decode()}
out.mkdir(parents=True);(out/'client.enc.json').write_text(json.dumps(payload,separators=(',',':')));shutil.copyfile(root/'static'/'buyer-portal'/'index-template.html',out/'index.html')
route_key=hashlib.sha256(homesearch.strip().lower().encode()).hexdigest()[:24];routes=root/'static'/'clients'/'routes';routes.mkdir(parents=True,exist_ok=True);(routes/f'{route_key}.json').write_text(json.dumps({'path':f'/buyers/{slug}/'},separators=(',',':')))
print(f"Created {out.relative_to(root)} and private client route")
print("Keep the password outside GitHub. The buyer enters through /clients/ using their HomeSearch name and password.")
