"""Stream large derived partitions into browser-sized pages (requires ijson)."""
from pathlib import Path
import json,gzip,hashlib
import ijson
ROOT=Path(__file__).resolve().parents[1];data=ROOT/'public/data';index_path=data/'trace-index.json.gz'
index=json.loads(gzip.decompress(index_path.read_bytes()));by_chunk={};manifest=json.loads((data/'manifest.json').read_text())
for t in index:by_chunk.setdefault(t['chunk'],[]).append(t)
processed=0
for path,traces in by_chunk.items():
 source=ROOT/'public'/path.lstrip('/')
 if source.stat().st_size<12*1024*1024 and max(t['spans'] for t in traces)<50000:continue
 print('Paging',source.name,flush=True)
 pages={};rows=[];page_number=0
 def flush():
  global rows,page_number
  if not rows:return
  target=source.with_name(source.name.replace('.json.gz',f'-page-{page_number:04}.json.gz'))
  raw=(json.dumps(rows,separators=(',',':'))+'\n').encode();target.write_bytes(gzip.compress(raw,mtime=0));url='/'+str(target.relative_to(ROOT/'public'))
  for tid in {r['trace_id'] for r in rows}:pages.setdefault(tid,[]).append(url)
  rows=[];page_number+=1
 with gzip.open(source,'rb') as stream:
  for row in ijson.items(stream,'item',use_float=True):
   rows.append(row)
   if len(rows)>=5000:flush()
 flush()
 for t in traces:t['chunks']=pages[t['trace_id']];t['chunk']=t['chunks'][0]
 source.unlink();processed+=1
index_path.write_bytes(gzip.compress(json.dumps(index,separators=(',',':')).encode(),mtime=0))
manifest['derivedFiles']=[]
for p in [index_path,data/'measurements.json',*(data/'spans').glob('*.gz')]:manifest['derivedFiles'].append({'path':'/'+str(p.relative_to(ROOT/'public')),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
manifest['traceExport']['browserPartitions']=len(list((data/'spans').glob('*.gz')))
manifest['traceExport']['paging']='Large traces use span pages. SQL and OTLP export apply to the displayed page; original full exports remain archived.'
(data/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert all(p.stat().st_size<=25*1024*1024 for p in (ROOT/'public').rglob('*') if p.is_file())
print('Repartitioned',processed,'large source chunks',flush=True)
