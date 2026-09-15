/** Reproducible edit workload; reported timings are observations, never CI thresholds. */
import {performance} from 'node:perf_hooks';
import {DocumentStore, find} from '../dist/core/model.js';
import {DocumentSession} from '../dist/core/document-session.js';
import {parseXaml} from '../dist/core/xaml.js';

const nodes=Number(process.env.XAMORA_BENCH_NODES||1000);
const edits=Number(process.env.XAMORA_BENCH_EDITS||40);
if(!Number.isInteger(nodes)||nodes<10||nodes>10000||!Number.isInteger(edits)||edits<1||edits>100)throw Error('Use 10–10000 nodes and 1–100 edits.');
const selected=Math.floor(nodes/2);
const source='<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">\n'+Array.from({length:nodes},(_,i)=>`  <Button Name="Button${i}" Content="Value ${i}" Width="120" />`).join('\n')+'\n</Grid>';

function run(incremental){
 const store=new DocumentStore(parseXaml(source)),session=new DocumentSession(store,{source,incremental});
 const target=store.document.root.children.find(n=>n.props?.Name==='Button'+selected),id=target.id;
 const initial={...session.processingStats};let previous='Value '+selected,snapshotEstimate=0;
 const start=performance.now();
 for(let i=0;i<edits;i++){
  const value='Edited '+String(i).padStart(3,'0');
  snapshotEstimate+=JSON.stringify(store.document).length*2;
  const next=session.source.replace('Content="'+previous+'"','Content="'+value+'"');
  const result=session.updateSource(next);
  if(!result.accepted||!result.valid||find(store.document.root,id)?.props.Content!==value)throw Error('Edit failed or lost target identity.');
  previous=value;
 }
 const elapsed=performance.now()-start,counts=Object.fromEntries(Object.entries(session.processingStats).map(([key,value])=>[key,value-initial[key]]));
 const history=typeof store.historyStats==='function'?store.historyStats():null;
 const finalSource=session.source;
 for(let i=0;i<edits;i++)session.undo();
 if(session.source!==source)throw Error('Undo did not restore exact source.');
 for(let i=0;i<edits;i++)session.redo();
 if(session.source!==finalSource)throw Error('Redo did not restore final source.');
 session.dispose();
 return {mode:incremental?'localized parsing':'full parsing',elapsedMs:Number(elapsed.toFixed(2)),averageEditMs:Number((elapsed/edits).toFixed(2)),counts,history,estimatedSnapshotPayloadBytes:snapshotEstimate,undoRedoVerified:true};
}

console.log(JSON.stringify({nodes,edits,sourceCodeUnits:source.length,nodeVersion:process.version,note:'CPU timings vary by machine and load. String copies, validation, transient rollback clones and rendering are separate remaining costs. Retention values are estimates, not measured heap usage.',results:[run(false),run(true)]},null,2));
