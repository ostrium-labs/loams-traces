import json,sqlite3,hashlib,gzip,itertools,os,re,struct
from pathlib import Path
from compression import zstd
w=Path(__file__).resolve().parents[1]; public=w/'public'; data=public/'data'; (data/'spans').mkdir(exist_ok=True)
m=json.loads((data/'manifest.json').read_text()); database=Path.home()/'.cache/loams-traces/normalize.sqlite'; database.parent.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect(database);db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=NORMAL');db.execute('PRAGMA cache_size=-200000');db.execute('PRAGMA temp_store=MEMORY');db.execute('CREATE TABLE IF NOT EXISTS spans(trace_id TEXT, span_id TEXT, parent_span_id TEXT, name TEXT, service TEXT, run TEXT, start_ns TEXT, start_ms REAL, duration_ms REAL, status TEXT, attributes TEXT, PRIMARY KEY(trace_id,span_id))')
secret=re.compile(r'password|secret|authorization|api[._-]?key|access[._-]?token',re.I); sensitive=set(); sources=[]
def attrs(xs):
 out={}
 for a in xs or []:
  k=a.get('key','');v=a.get('value',{});v=next(iter(v.values()),None) if isinstance(v,dict) else v
  if secret.search(k):sensitive.add(k);v='[REDACTED]'
  out[k]=v
 return out
def add_span(tid,sid,parent,name,service,run,start,duration,status,attributes):
 if not tid or not sid:return
 db.execute('INSERT OR IGNORE INTO spans VALUES(?,?,?,?,?,?,?,?,?,?,?)',(str(tid),str(sid),str(parent),str(name),str(service),str(run),str(start),int(start)/1e6,max(0,float(duration)/1e6),str(status),json.dumps(attributes,separators=(',',':'))))
def otlp(payload):
 for r in payload.get('resourceSpans',[]):
  resource=attrs(r.get('resource',{}).get('attributes',[]));service=resource.get('service.name','unknown');run=resource.get('rbench.run',resource.get('cfb.run','unknown'))
  for scope in r.get('scopeSpans',r.get('instrumentationLibrarySpans',[])):
   for s in scope.get('spans',[]):
    a=attrs(s.get('attributes',[]));start=s.get('startTimeUnixNano','0');end=s.get('endTimeUnixNano',start)
    add_span(s.get('traceId'),s.get('spanId'),s.get('parentSpanId',''),s.get('name','span'),service,run,start,int(end)-int(start),s.get('status',{}).get('code',0),{'resource':resource,'span':a})
large_root=Path('/home/dinakaran/Documents/Ostriumlabs/resonate-wt/bench-2026-10-24/bench/stacks/signoz/traces')
large_entries=[]
for p in sorted(large_root.glob('*.jsonl')):
 print('Reading compressed OTLP export:',p.name,flush=True)
 parts=[];full=hashlib.sha256()
 with p.open('rb') as f:
  for i,block in enumerate(iter(lambda:f.read(16*1024*1024),b'')):
   full.update(block);sha=hashlib.sha256(block).hexdigest();dest=data/'objects'/f'{sha}.part';dest.write_bytes(block);parts.append({'path':'/data/objects/'+dest.name,'sha256':sha,'bytes':len(block)})
 large_entries.append({'id':full.hexdigest(),'name':p.name,'bytes':p.stat().st_size,'sha256':full.hexdigest(),'parts':parts,'format':'OTel file exporter: big-endian length-prefixed zstd JSON','sanitized':False,'sources':[{'repository':'resonate','path':'bench/stacks/signoz/traces/'+p.name,'revision':'19743967'}]})
 frames=0
 with p.open('rb') as f:
  while header:=f.read(4):
   if len(header)!=4:raise ValueError('Truncated OTLP frame header')
   length=int.from_bytes(header,'big');block=f.read(length)
   if len(block)!=length:raise ValueError('Truncated OTLP frame')
   payload=json.loads(zstd.decompress(block));otlp(payload);frames+=1
   if frames%25==0:db.commit();print('Frames:',frames,flush=True)
 db.commit();sources.append({'name':p.name,'frames':frames})
for artifact in m['artifacts']:
 if not artifact.get('path','').endswith('.json'):continue
 try:payload=json.loads((public/artifact['path'].lstrip('/')).read_text())
 except (ValueError,UnicodeError):continue
 if not isinstance(payload,dict):continue
 if 'resourceSpans' in payload:otlp(payload)
 if isinstance(payload.get('spans'),list):
  for s in payload['spans']:
   resource=s.get('res',{});a=s.get('attrs',{})
   if 'start_ns' not in s:continue
   add_span(payload.get('trace_id',s.get('trace_id')),s.get('span_id'),s.get('parent_span_id',''),s.get('name','span'),resource.get('service.name','cfb-driver'),resource.get('cfb.run',payload.get('target','unknown')),s['start_ns'],s.get('duration_nano',0),s.get('status_code',0),{'resource':resource,'span':a})
db.commit()
if sensitive:raise ValueError('Credential-like OTLP attribute keys require archive redaction: '+str(sensitive))
columns=[d[0] for d in db.execute('SELECT * FROM spans LIMIT 0').description];index=[];chunk=[];chunk_traces=[];count=0
def flush():
 global chunk,chunk_traces,count
 if not chunk:return
 name=f'chunk-{count:04}.json.gz';raw=(json.dumps(chunk,separators=(',',':'))+'\n').encode();compressed=gzip.compress(raw,mtime=0);(data/'spans'/name).write_bytes(compressed)
 path='/data/spans/'+name
 for t in chunk_traces:t['chunk']=path;index.append(t)
 count+=1;chunk=[];chunk_traces=[]
for tid,rows in itertools.groupby(db.execute('SELECT * FROM spans ORDER BY trace_id,start_ns'),lambda r:r[0]):
 group=[dict(zip(columns,r)) for r in rows];start=min(r['start_ms'] for r in group);end=max(r['start_ms']+r['duration_ms'] for r in group)
 chunk.extend(group);chunk_traces.append({'trace_id':tid,'service':group[0]['service'],'run':group[0]['run'],'name':group[0]['name'],'spans':len(group),'duration_ms':end-start,'start_ms':start})
 if len(chunk)>=20000:flush()
flush();index.sort(key=lambda t:t['start_ms'],reverse=True)
(data/'trace-index.json').write_text(json.dumps(index,separators=(',',':'))+'\n')
m['artifacts'].extend(large_entries);m['skipped']=[];m['traceExport']={'spans':db.execute('SELECT count(*) FROM spans').fetchone()[0],'traces':len(index),'chunks':count,'sources':sources,'deduplication':'trace_id + span_id','timestampPrecision':'Original nanoseconds retained as strings; browser timeline uses milliseconds.'}
for p in (data/'spans').glob('*.gz'):
 m.setdefault('derivedFiles',[]).append({'path':'/data/spans/'+p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
(data/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps(m['traceExport']),flush=True)
