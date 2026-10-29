"""Usage: python scripts/reassemble.py <artifact-sha256> <destination>"""
import json,sys,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'public'
sha,destination=sys.argv[1:];target=Path(destination)
if target.exists():raise SystemExit('Destination already exists; refusing to overwrite it.')
manifest=json.loads((ROOT/'data/manifest.json').read_text());a=next(a for a in manifest['artifacts'] if a['sha256']==sha)
h=hashlib.sha256()
with target.open('xb') as out:
 for part in a.get('parts',[a]):
  with (ROOT/part['path'].lstrip('/')).open('rb') as source:
   for block in iter(lambda:source.read(1024*1024),b''):h.update(block);out.write(block)
assert h.hexdigest()==sha,'Reassembled checksum mismatch'
print('Verified:',sha)
