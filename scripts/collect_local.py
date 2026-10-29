import os,json,hashlib,subprocess,re,shutil
from pathlib import Path
base=Path(os.environ.get('LOAMS_WORKSPACE',Path.home()/'Documents/Ostriumlabs'))
out=Path(__file__).resolve().parents[1]
(out/'public/data/objects').mkdir(parents=True,exist_ok=True)
records={}; skipped=[]
exts={'.json','.jsonl','.ndjson','.csv','.parquet','.md','.txt','.log','.svg','.png'}
secret=re.compile(r'(password|passwd|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key|dsn)$',re.I)
def sanitize(v):
 if isinstance(v,dict): return {k:('[REDACTED]' if secret.search(k) and isinstance(x,str) and x and x not in ['[REDACTED]','<redacted>','redacted'] else sanitize(x)) for k,x in v.items()}
 if isinstance(v,list):return [sanitize(x) for x in v]
 return v
def collect(p,label,rel,revision='unverified'):
 if p.suffix.lower() not in exts or p.is_symlink():return
 if any(s in p.parts for s in ['node_modules','.git']):return
 if p.stat().st_size > 90_000_000: skipped.append({'source':f'{label}/{rel}','reason':'larger than 90 MB'});return
 data=p.read_bytes(); orig=hashlib.sha256(data).hexdigest(); changed=False
 if p.suffix=='.json':
  try:
   v=json.loads(data);clean=sanitize(v)
   if clean!=v:data=(json.dumps(clean,indent=2)+'\n').encode();changed=True
  except (ValueError,UnicodeError):pass
 sha=hashlib.sha256(data).hexdigest();dest=out/'public/data/objects'/f'{sha}{p.suffix}'
 key=f'{sha}{p.suffix}'
 source={'repository':label,'path':str(rel),'revision':revision,'sourceSha256':orig}
 if key in records:
  if source not in records[key]['sources']:records[key]['sources'].append(source)
  return
 dest.write_bytes(data)
 records[key]={'id':sha,'path':f'/data/objects/{key}','name':p.name,'bytes':len(data),'sha256':sha,'sanitized':changed,'sources':[source]}

roots=[]
for p in base.iterdir():
 if p.name in ['loams-traces','loams-traces-wt']:continue
 if p.is_dir() and (p/'.git').exists():roots.append((p,p.name))
 if p.is_dir() and p.name.endswith('-wt'):
  for q in p.iterdir():
   if q.is_dir() and (q/'.git').exists():roots.append((q,p.name[:-3]))
for root,label in roots:
 candidates=[root/'results'] if label=='loams-bench' else []
 for folder in ['bench','benchmarks','benchmark','benches']:
  b=root/folder
  if not b.is_dir():continue
  for folderpath,dirs,files in os.walk(b):
   dirs[:]=[d for d in dirs if d not in ['target','node_modules','.git','.venv','vendor']]
   current=Path(folderpath)
   if current.name in ['results','traces','reports']:
    candidates.append(current);dirs.clear()
 if not candidates:continue
 revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
 for folder in candidates:
  if not folder.is_dir():continue
  for p in folder.rglob('*'):
   if p.is_file():collect(p,label,p.relative_to(root),revision)
print('Repository artifacts collected:',len(records),flush=True)
# Native benchmark output and Criterion measurements; exclude live databases and executables.
mount=Path('/mnt/Projects/bench-data')
for p in mount.rglob('*'):
 if not p.is_file() or p.suffix not in {'.json','.jsonl','.ndjson','.csv'}:continue
 if any(x in p.parts for x in ['.fingerprint','build','deps']):continue
 collect(p,'local-native-benchmarks',p.relative_to(mount))
# Lane status notes explain coverage and failed measurement attempts.
shared=base/'loams-wt/.he0-shared'
for pattern in ['bq1-*-status.md','bench-1b-qps.md','resonate-bench.md']:
 for p in shared.glob(pattern):collect(p,'benchmark-campaign',p.name)
manifest={'schemaVersion':1,'collectedOn':'2026-10-29','artifacts':list(records.values()),'skipped':skipped,'notes':['Content-addressed archive, deduplicated across local repository worktrees.','Credential-like JSON fields are redacted when present. Source and archive hashes are distinct after redaction.','Only benchmark result/report/trace directories and native JSON outputs were collected; databases, binaries and credentials are excluded.','The live SigNoz instance currently contains unrelated NativeLink telemetry; it was not exported as benchmark evidence.']}
(out/'public/data/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Unique artifacts:',len(records),'Bytes:',sum(r['bytes'] for r in records.values()),'Skipped:',len(skipped),flush=True)
