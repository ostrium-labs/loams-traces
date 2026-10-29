"""Index measured rates without adding unlike units or labelling offered rates as success."""
import json,math,hashlib,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RATE_KEYS={'successful_qps':'queries/s','successful_operations_per_second':'validated operations/s','throughput_wf_s':'workflows/s','ops_per_s':'operations/s','produce_msgs_per_s':'acknowledged records/s','tps':'select-only transactions/s','qps':'reported operations/s'}
def numeric(x):return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def measurement(v,context):
 if isinstance(v.get('stdout'),str):
  match=re.search(r'tps = ([0-9.]+)',v['stdout'])
  if match:
   failed=re.search(r'number of failed transactions: (\d+)',v['stdout'])
   return {'rate':float(match.group(1)) if v.get('exit_code')==0 else None,'unit':'select-only transactions/s','errors':int(failed.group(1)) if failed else None,'p99_ms':None,'clients':v.get('clients'),'note':'Native pgbench, warmed read-only development workload with fsync=off; not per-query value verification.'}
 for key,unit in RATE_KEYS.items():
  if key not in v or not numeric(v[key]):continue
  err=v.get('failed_operations',v.get('errors',v.get('failed',v.get('error_replies'))))
  if isinstance(err,dict):err=sum(x for x in err.values() if numeric(x))
  if not numeric(err):err=None
  rate=v[key];note='Single recorded run; compare only matching workload, topology and units.'
  if key=='qps' and ('ok' in v and v['ok']==0):rate=None;note='No successful completions; reported QPS is not successful throughput.'
  elif key=='qps' and err not in [None,0]:rate=None;note='Errors present; raw QPS does not establish successful throughput.'
  if rate is not None and rate<0:rate=None
  latency=v.get('latency',{}) if isinstance(v.get('latency'),dict) else {}
  p99=v.get('p99_ms',latency.get('p99_ms'))
  if p99 is None:
   us=v.get('latency_p99_us',v.get('p99_us'));p99=us/1000 if numeric(us) else None
  return {'rate':rate,'unit':unit,'errors':err,'p99_ms':p99 if numeric(p99) else None,'clients':v.get('clients',v.get('concurrency',context.get('clients'))),'note':note}
 return None
def engine_for(source,v):
 p=source['path'];parts=Path(p).parts
 if 'bq1' in parts:
  i=parts.index('bq1');return parts[i+1] if i+1<len(parts) else 'native'
 if source['repository']=='resonate':return str(v.get('system','Durable workflows'))
 if 'confluent' in p:return 'Kafka / Confluent'
 return str(v.get('engine',v.get('workload',v.get('scenario',source['repository']))))
def index():
 manifest=json.loads((ROOT/'public/data/manifest.json').read_text());rows=[]
 for a in manifest['artifacts']:
  if not a.get('path','').endswith(('.json','.jsonl','.ndjson')):continue
  p=ROOT/'public'/a['path'].lstrip('/')
  if p.stat().st_size>30_000_000:continue
  try:
   text=p.read_text()
   try:payload=json.loads(text)
   except ValueError:payload=[json.loads(line) for line in text.splitlines() if line.strip()]
  except (ValueError,UnicodeError):continue
  source=a['sources'][0];root=payload if isinstance(payload,dict) else {};engine=engine_for(source,root);engine={'kv':'Loams KV','airflow':'Loams Flow','house':'Loams House','git':'Loams Git','stream':'Native stream gRPC'}.get(engine,engine)
  context={'clients':root.get('clients',root.get('concurrency'))}
  def walk(v,path=''):
   if isinstance(v,list):
    if len(v)<10000:
     for i,child in enumerate(v):walk(child,path+f'[{i}]')
   if not isinstance(v,dict):return
   result=measurement(v,context)
   if result:
    workload=str(v.get('workload',v.get('scenario',root.get('workload',root.get('scenario',root.get('label',a['name']))))))
    rows.append({'id':hashlib.sha256((a['id']+path).encode()).hexdigest()[:20],'engine':engine,'workload':workload+((' / '+path) if path else ''),'build':str(root.get('build_profile','not pinned in this record')),'source':source['repository']+'/'+source['path'],'path':a['path'],**result})
   for key,child in v.items():
    if key not in ['latencies_ms','latency_buckets_us','requests','steps','latency','params','resources','spans','resourceSpans']:walk(child,path+'.'+key)
  walk(payload)
 (ROOT/'public/data/measurements.json').write_text(json.dumps(rows,separators=(',',':'))+'\n')
 print('Indexed measurements:',len(rows))
if __name__=='__main__':index()
