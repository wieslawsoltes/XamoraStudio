import test from 'node:test';
import assert from 'node:assert/strict';
import {mapTextSelection} from '../dist/core/editor.js';

test('source patches keep both endpoints of a selection outside the edit',()=>{
 const before='<Grid><Button Content="Before"/><TextBlock Text="Selected"/></Grid>';
 const after=before.replace('Before','Longer content');
 const start=before.indexOf('Selected');
 assert.deepEqual(mapTextSelection(before,after,start,start+8),{start:after.indexOf('Selected'),end:after.indexOf('Selected')+8});
});
test('source patches preserve caret before a later property change',()=>{
 const before='<Grid><Button Content="Before"/></Grid>';
 assert.deepEqual(mapTextSelection(before,before.replace('Before','After'),6,13),{start:6,end:13});
});
test('caret inside removed source clamps to the nearest surviving position',()=>{
 const before='<Grid><Button/></Grid>',after='<Grid></Grid>';
 assert.deepEqual(mapTextSelection(before,after,8,13),{start:7,end:7});
});
test('unchanged source retains a noncollapsed selection without moving it',()=>{
 assert.deepEqual(mapTextSelection('hello','hello',1,4),{start:1,end:4});
});
