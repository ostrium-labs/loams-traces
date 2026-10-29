"""Verify every archived artifact, ordered part and derived partition."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'public'
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
manifest=json.loads((ROOT/'data/manifest.json').read_text());count=0
for artifact in manifest['artifacts']:
 if artifact.get('parts'):
  combined=hashlib.sha256()
  for part in artifact['parts']:
   p=ROOT/part['path'].lstrip('/');assert digest(p)==part['sha256'],p
   with p.open('rb') as f:
    for block in iter(lambda:f.read(1024*1024),b''):combined.update(block)
  assert combined.hexdigest()==artifact['sha256'],artifact['name']
 else:assert digest(ROOT/artifact['path'].lstrip('/'))==artifact['sha256'],artifact['name']
 count+=1
for f in manifest.get('derivedFiles',[]):assert digest(ROOT/f['path'].lstrip('/'))==f['sha256'],f['path']
assert not manifest['skipped'],manifest['skipped']
print(f'Verified {count} artifacts, all ordered parts and {len(manifest.get("derivedFiles",[]))} derived files.')
