"""Finish the static archive after normalization. All hosted assets remain below 25 MiB."""
from pathlib import Path
import json,gzip,hashlib,os
ROOT=Path(__file__).resolve().parents[1]; data=ROOT/'public/data'
manifest=json.loads((data/'manifest.json').read_text())
assert manifest.get('traceExport'), 'Run normalization to completion first.'
for artifact in manifest['artifacts']:
 if not artifact.get('parts'):continue
 parts=[]
 for old in artifact['parts']:
  p=ROOT/'public'/old['path'].lstrip('/')
  with p.open('rb') as f:
   for block in iter(lambda:f.read(16*1024*1024),b''):
    sha=hashlib.sha256(block).hexdigest();target=data/'objects'/f'{sha}.part';target.write_bytes(block);parts.append({'path':'/data/objects/'+target.name,'sha256':sha,'bytes':len(block)})
 artifact['parts']=parts
# Retain the exact reports and scope manifest alongside their result files.
reports=Path(os.environ.get('LOAMS_BENCH_SOURCE',Path.home()/'Documents/Ostriumlabs/loams-bench-wt/swarm-scale'))
for name in ['README.md','RELEASE-SUITE.md','engines.json']:
 raw=(reports/name).read_bytes();sha=hashlib.sha256(raw).hexdigest();target=data/'objects'/f'{sha}{Path(name).suffix}';target.write_bytes(raw)
 manifest['artifacts'].append({'id':sha,'name':name,'path':'/data/objects/'+target.name,'bytes':len(raw),'sha256':sha,'sanitized':False,'sources':[{'repository':'loams-bench','path':name,'revision':'e9d1b83','sourceSha256':sha}]})
index=data/'trace-index.json'; compressed=data/'trace-index.json.gz';compressed.write_bytes(gzip.compress(index.read_bytes(),mtime=0));index.unlink()
manifest['artifacts']=list({(a['id'],a['name']):a for a in manifest['artifacts']}.values())
manifest['derivedFiles']=[]
for p in [compressed,data/'measurements.json',*(data/'spans').glob('*.gz')]:
 manifest['derivedFiles'].append({'path':'/'+str(p.relative_to(ROOT/'public')),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
referenced={p['path'] for a in manifest['artifacts'] for p in a.get('parts',[])}
for p in (data/'objects').glob('*.part'):
 if '/data/objects/'+p.name not in referenced:p.unlink()
manifest['notes'].append('Source revisions identify the collecting checkout, not proof of executable build provenance. Historical benchmark reports retain their original dates and names.')
(data/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
large=[str(p.relative_to(ROOT/'public')) for p in (ROOT/'public').rglob('*') if p.is_file() and p.stat().st_size>25*1024*1024]
assert not large,large
print('Archive finalized:',len(manifest['artifacts']),'artifacts;',manifest['traceExport'])
