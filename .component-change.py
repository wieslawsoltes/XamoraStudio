import base64,hashlib,json,lzma,os,shutil,subprocess,sys
from pathlib import Path
root=Path.cwd()
encoded=b''.join(p.read_bytes() for p in sorted(Path('.component-change').glob('*.b64')))
compressed=base64.b64decode(encoded,validate=True)
if hashlib.sha256(compressed).hexdigest()!='daf6a5d0232726e98cfdcf5a4e32f98349d97e12130627449e7b49fc33db7450': raise RuntimeError('Migration checksum mismatch')
data=json.loads(lzma.decompress(compressed))
folder=Path('.component-migration');folder.mkdir()
for name,content in data['bootstrap'].items():
 if '/' in name or not name.endswith('.mjs'):raise RuntimeError('Invalid bootstrap path')
 (folder/name).write_text(content)
subprocess.run(['node',str(folder/'bootstrap.mjs')],check=True)
def path(value):
 p=Path(value)
 if p.is_absolute() or '..' in p.parts:raise RuntimeError('Invalid output path')
 return p
results={}
for op in data['operations']:
 target=path(op['path'])
 if op.get('delete'):results[str(target)]=None;continue
 if 'copy' in op:result=results[op['copy']]
 elif 'text' in op:result=op['text']
 else:
  base=path(op['base']).read_text()
  if hashlib.sha256(base.encode()).hexdigest()!=op['baseSha256']:raise RuntimeError('Unexpected generated input '+op['base'])
  result=''.join(piece if isinstance(piece,str) else base[piece[0]:piece[1]] for piece in op['pieces'])
 if hashlib.sha256(result.encode()).hexdigest()!=op['sha256']:raise RuntimeError('Invalid assembled output '+str(target))
 results[str(target)]=result
for name,text in results.items():
 p=path(name)
 if text is None:p.unlink(missing_ok=True)
 else:p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
shutil.rmtree(folder);shutil.rmtree('.component-change')
Path('.component-change.py').unlink(missing_ok=True)
print('Applied and checksum-verified',len(results),'source changes')
