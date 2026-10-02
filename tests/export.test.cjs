const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.EXPORT_REPO_ROOT || path.resolve(__dirname, '..');
const TPS = 254016000000n;
function time(seconds) {
  const ticks = typeof seconds === 'string' ? seconds : String(BigInt(Math.round(seconds * 48000)) * (TPS / 48000n));
  return { ticks, seconds: Number(ticks) / Number(TPS) };
}
function collection(items, count = 'numItems') { items[count] = items.length; return items; }
function clip(id, kind, start, end, options = {}) {
  const item = {
    nodeId: id, type: 1, mediaType: kind, name: options.name || 'same name',
    start: time(start), end: time(end), inPoint: time(options.sourceIn ?? 30),
    outPoint: time(options.sourceOut ?? 30 + end - start), disabled: false,
    projectItem: { nodeId: options.sourceId || 'source', name: options.sourceName || 'Nested source', isSequence: () => !!options.nested, isMulticamClip: () => !!options.multicam, getMediaPath: () => options.nested || options.multicam ? '' : '/media/source.mov' },
    getSpeed: () => options.speed ?? 1,
    isSpeedReversed: () => !!options.reversed,
    components: collection(options.components || []),
    isMGT: () => !!options.graphic,
    isSelected: () => options.selected !== false,
    isAdjustmentLayer: () => !!options.adjustment,
    getLinkedItems: () => collection(item.links || []),
  };
  if(options.graphic)item.projectItem=null;
  return item;
}
function linked(...items) { items.forEach(item => item.links = items.filter(other => other !== item)); }
function fixture(videos = [], audios = [], options = {}) {
  const calls = [], files = new Set(['/video.epr', '/audio.epr']), dirs = new Set(['/out']);
  const wrapTracks = tracks => collection(tracks.map(items => ({
    clips: collection(items), transitions: collection([]), muted: false,
    isMuted() { return this.muted; }, setMute(value) { this.muted = !!value; },
  })), 'numTracks');
  const seq = {
    name: 'Test original', sequenceID: 'original', timebase: String(TPS / 25n),
    videoTracks: wrapTracks(videos), audioTracks: wrapTracks(audios),
    captionTracks: collection([], 'numTracks'), inValue: time(2), outValue: time(8),
    getInPointAsTime() { return this.inValue; }, getOutPointAsTime() { return this.outValue; },
    getExportFileExtension(preset) { return preset === '/audio.epr' ? 'wav' : 'mp4'; },
    setInPoint(value) { this.inValue = time(value); }, setOutPoint(value) { this.outValue = time(value); },
    markers: { numMarkers: 0 },
  };
  let cloneCount = 0;
  function cloneTracks(tracks) {
    const copied = wrapTracks(Array.from(tracks, track => Array.from(track.clips, item => {
      const copy = { ...item, nodeId: 'copy-' + cloneCount + '-' + item.nodeId };
      if (options.disableFails) Object.defineProperty(copy, 'disabled', { get: () => false, set: () => {} });
      copy.remove=function(ripple,align){calls.push(['remove',this.nodeId,ripple,align]);if(options.removeThrows)throw Error('remove failed');if(options.removeNoOp)return 0;for(const tracks of [project.activeSequence.videoTracks,project.activeSequence.audioTracks])for(const track of tracks){const n=track.clips.indexOf(this);if(n>=0){track.clips.splice(n,1);track.clips.numItems=track.clips.length;}}return 0;};
      return copy;
    })));
    for(let i=0;i<copied.length;i++)copied[i].transitions=collection(Array.from(tracks[i].transitions,tr=>({...tr,nodeId:'copy-transition-'+tr.nodeId})));
    return copied;
  }
  const project = {
    activeSequence: seq, sequences: collection([seq], 'numSequences'),
    openSequence(id) { if (!options.reopenNoOp) this.activeSequence = this.sequences.find(item => item.sequenceID === id); return true; },
  };
  seq.clone = function () {
    cloneCount++;
    const copy = { ...seq, sequenceID: 'copy-' + cloneCount,
      videoTracks: cloneTracks(seq.videoTracks), audioTracks: cloneTracks(seq.audioTracks) };
    if (options.badCloneMute) copy.videoTracks[0].isMuted = () => undefined;
    if (options.cloneTransitionMismatch && copy.videoTracks[0].transitions.length)copy.videoTracks[0].transitions[0].end=time(999);
    if (options.cloneGraphicMismatch)copy.videoTracks[0].clips[0].isMGT=()=>false;
    if (options.cloneMismatch) copy.videoTracks[0].clips[0].inPoint = time(999);
    if (options.cloneSpeedMismatch) copy.videoTracks[0].clips[0].getSpeed = () => 999;
    if (options.cloneKindMismatch) copy.videoTracks[0].clips[0].projectItem = { ...copy.videoTracks[0].clips[0].projectItem, isMulticamClip: () => true };
    if (options.cloneEffectMismatch) copy.videoTracks[0].clips[0].components = collection([]);
    if (options.roundAudio) {
      copy.setInPoint = function (value) { this.inValue = time(Math.round(value * 25) / 25); };
      copy.setOutPoint = function (value) { this.outValue = time(Math.round(value * 25) / 25); };
    }
    project.sequences.push(copy); project.sequences.numSequences = project.sequences.length;
    project.activeSequence = copy;
    return options.cloneBoolean ? true : copy;
  };
  function File(name) { this.fsName = name; Object.defineProperty(this, 'exists', {get:()=>files.has(name)}); }
  function Folder(name) { this.fsName = name; this.exists = dirs.has(name); }
  Folder.prototype.create = function () { dirs.add(this.fsName); this.exists = true; return true; };
  const encoder = {
    launchEncoder() { calls.push(['launch']); return options.legacyLaunch ? 0 : true; },
    encodeSequence(sequence, output, preset, workArea, remove, immediate) {
      calls.push(['encode', sequence, output, preset, workArea, remove, immediate]);
      if (options.queueThrows) throw new Error('AME disconnected');
      if (options.rejectAfter != null && calls.filter(call => call[0] === 'encode').length > options.rejectAfter) return '0';
      return String(calls.length);
    },
    startBatch() { calls.push(['start']); },
  };
  const snapshots = new Map();
  // Minimal E4X adapter for Node: production ExtendScript provides native XML/ XMLList.
  function xmlList(nodes) {const list={length:()=>nodes.length,child(name){return xmlList(nodes.flatMap(n=>n.children.filter(c=>c.name===name)))},toString(){return nodes.map(n=>n.text).join('')}};nodes.forEach((n,i)=>list[i]={child:name=>xmlList(n.children.filter(c=>c.name===name)),attribute:name=>n.attrs?.[name]||'',toString:()=>n.text,name:()=>n.name});return list;}
  function parseXML(text) {const top={name:'#',children:[],text:''},stack=[top];for(const token of text.match(/<[^>]*>|[^<]+/g)||[]){if(token.startsWith('</'))stack.pop();else if(token.startsWith('<')){if(/^<[?!]/.test(token))continue;const node={name:/^<([^\s>]+)/.exec(token)[1],attrs:Object.fromEntries([...token.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]])),children:[],text:''};stack.at(-1).children.push(node);if(!token.endsWith('/>'))stack.push(node);}else stack.at(-1).text+=token;}return xmlList(top.children);}
  File.prototype.open=function(){return snapshots.has(this.fsName)};File.prototype.read=function(){return snapshots.get(this.fsName)};File.prototype.close=function(){};File.prototype.remove=function(){files.delete(this.fsName);return snapshots.delete(this.fsName)};
  Folder.prototype.getFiles=function(){return [...files].filter(name=>name.startsWith(this.fsName+'/')).map(name=>new File(name));};Folder.prototype.remove=function(){return dirs.delete(this.fsName)};
  Folder.temp={fsName:'/tmp'};dirs.add('/tmp');
  seq.exportAsFinalCutProXML=function(output){
    if(options.xmlThrows)throw Error('snapshot failed');
    let text='<xmeml><sequence><media>';
    for(const kind of ['video','audio']){text+='<'+kind+'>';for(const track of seq[kind+'Tracks']){text+='<track>';for(const item of track.clips){
      if(options.xmlOmit===item.nodeId)continue;
      text+='<clipitem><name>'+item.name+'</name><enabled>'+(item.legacyDisabled?'FALSE':'TRUE')+'</enabled><start>'+Number(BigInt(item.start.ticks)/BigInt(seq.timebase))+'</start><end>'+Number(BigInt(item.end.ticks)/BigInt(seq.timebase))+'</end><pproTicksIn>'+item.inPoint.ticks+'</pproTicksIn><pproTicksOut>'+item.outPoint.ticks+'</pproTicksOut></clipitem>';
    }for(const tr of track.transitions){if(!tr.xmlAlignment)continue;const unit=BigInt(seq.timebase);text+='<transitionitem><start>'+BigInt(tr.start.ticks)/unit+'</start><end>'+BigInt(tr.end.ticks)/unit+'</end><pproTicksIn>'+tr.start.ticks+'</pproTicksIn><pproTicksOut>'+tr.end.ticks+'</pproTicksOut><alignment>'+tr.xmlAlignment+'</alignment><cutPointTicks>'+(tr.xmlCut??(tr.xmlAlignment==='end-black'?BigInt(tr.end.ticks)-BigInt(tr.start.ticks):0))+'</cutPointTicks></transitionitem>';}text+='</track>';}text+='</'+kind+'>';}text+='</media></sequence></xmeml>';
    if(options.xmlTransitionDuplicate)text=text.replace(/(<transitionitem>[\s\S]*?<\/transitionitem>)/,'$1$1');
    if(options.xmlTransitionChannelConflict)text=text.replace(/end-black/g,'center');
    if(options.xmlRoundFrames)text=text.replace(/<(start|end)>(\d+)<\/\1>/g,(_,key,value)=>'<'+key+'>'+value+'</'+key+'>');
    if(options.xmlMissingPproTicks)text=text.replace(/<pproTicks(In|Out)>\d+<\/pproTicks\1>/g,'');
    if(options.xmlSourceFrames)text=text.replace(/<pproTicksIn>(\d+)<\/pproTicksIn><pproTicksOut>(\d+)<\/pproTicksOut>/g,(_,inside,outside)=>'<rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate><in>'+Number(BigInt(inside)/BigInt(seq.timebase))+'</in><out>'+Number(BigInt(outside)/BigInt(seq.timebase))+'</out>');
    if(options.xmlWrongSourceTicks)text=text.replace(/<pproTicksIn>\d+<\/pproTicksIn>/g,'<pproTicksIn>999</pproTicksIn>');
    if(options.xmlFileReferences)text=text.replace(/<clipitem>/g,'<clipitem><file id="same-source-file"/>');
    if(options.xmlCorrupt)text=text.replace('<enabled>TRUE</enabled>','<enabled>MAYBE</enabled>');
    if(options.xmlStereo)text=text.replace(/<audio>([\s\S]*?)<\/audio>/,(_,audio)=>'<audio>'+audio.replace(/<track>([\s\S]*?)<\/track>/g,(_,body)=>'<track currentExplodedTrackIndex="0" totalExplodedTrackCount="2" premiereTrackType="Stereo">'+body+'</track><track currentExplodedTrackIndex="1" totalExplodedTrackCount="2" premiereTrackType="Stereo">'+(options.xmlChannelConflict?body.replace(/<enabled>TRUE/g,'<enabled>FALSE'):body)+'</track>')+'</audio>');
    if(options.xmlTransform)text=options.xmlTransform(text);
    files.add(output);snapshots.set(output,text);return true;
  };
  const context = vm.createContext({ $: {global:{}}, app: { version:options.version||'26.0', project, encoder }, File, Folder, XML:function(text){const list=parseXML(text);return list[0]}, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'com.texs.markerexport/host/export-markers.jsx'), 'utf8'), context);
  const preview = scope => context.previewClipExports(scope || 'selected');
  const queue = scope => context.exportClipsAsFiles('/out', '/video.epr', '/audio.epr', scope || 'selected');
  return { seq, project, calls, files, dirs, context, preview, queue };
}
function encoded(f) { return f.calls.filter(call => call[0] === 'encode'); }
function markerFixture() {
  const f = fixture([[clip('v', 'Video', 0, 12)]], []);
  const markers = [0, 4, 8, 12].map((s, i) => ({ start: time(s), end: time(s), name: 'marker ' + i }));
  f.seq.markers = { numMarkers: markers.length, getFirstMarker: () => markers[0], getNextMarker: item => markers[markers.indexOf(item) + 1] };
  return f;
}
test('marker jobs preserve original In/Out points and never start the AME batch', () => {
  const f = markerFixture();
  const result = f.context.exportMarkersAsClips('/out', '/video.epr');
  assert.match(result, /Queued 3/);
  assert.equal(f.seq.getInPointAsTime().seconds, 2);
  assert.equal(f.seq.getOutPointAsTime().seconds, 8);
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 0);
  assert.equal(new Set(encoded(f).map(call => call[1].sequenceID)).size, 3);
});
test('four cut videos with third AV unlinked become four videos plus one independent audio', () => {
  const v = [clip('v1', 'Video', 0, 4), clip('v2', 'Video', 3, 9), clip('v3', 'Video', 8, 12), clip('v4', 'Video', 12, 16)];
  const a = [clip('a1', 'Audio', 0, 4), clip('a2', 'Audio', 3, 9), clip('a3', 'Audio', 8, 12), clip('a4', 'Audio', 12, 16)];
  linked(v[0], a[0]); linked(v[1], a[1]); linked(v[3], a[3]);
  const f = fixture([[v[0], v[2], v[3]], [v[1]]], [a]);
  assert.match(f.preview('all'), /4 video.*1 audio/);
  assert.match(f.queue('all'), /Queued 5/);
  assert.equal(encoded(f).filter(call => call[3] === '/video.epr').length, 4);
  assert.equal(encoded(f).filter(call => call[3] === '/audio.epr').length, 1);
});
test('overlapping unrelated video and audio are disabled in each isolated copy', () => {
  const v1 = clip('v1', 'Video', 10, 14, { sourceIn: 100, sourceOut: 104 });
  const a1 = clip('a1', 'Audio', 10, 14); linked(v1, a1);
  const f = fixture([[v1], [clip('v2', 'Video', 11, 13, { selected: false })]], [[a1], [clip('music', 'Audio', 0, 60, { selected: false })]]);
  assert.match(f.queue(), /Queued 1/);
  const copy = encoded(f)[0][1];
  assert.equal(copy.videoTracks[0].clips[0].disabled, false);
  assert.equal(copy.videoTracks[1].clips[0].disabled, true);
  assert.equal(copy.audioTracks[1].clips[0].disabled, true);
  assert.equal(copy.getInPointAsTime().seconds, 10);
  assert.equal(copy.getOutPointAsTime().seconds, 14);
  assert.equal(copy.videoTracks[0].clips[0].inPoint.seconds, 100);
  assert.equal(v1.disabled, false);
  assert.equal(f.project.activeSequence, f.seq);
});
test('same source name and matching times never imply an AV link', () => {
  const f = fixture([[clip('v', 'Video', 5, 9)]], [[clip('a', 'Audio', 5, 9)]]);
  assert.match(f.preview(), /1 video.*1 audio/);
});
test('selecting only audio in a real AV link still yields one combined video job', () => {
  const v = clip('v', 'Video', 0, 4, { selected: false }), a = clip('a', 'Audio', 0, 4); linked(v, a);
  const f = fixture([[v]], [[a]]);
  assert.match(f.preview(), /1 video.*0 audio/);
});
test('empty selection blocks exporting all clips accidentally', () => {
  const f = fixture([[clip('v', 'Video', 0, 4, { selected: false })]]);
  assert.match(f.queue(), /^ERROR:.*select/i); assert.equal(encoded(f).length, 0);
});
test('missing official link API is blocked without guessing', () => {
  const item = clip('v', 'Video', 0, 4); delete item.getLinkedItems;
  const f = fixture([[item]]); assert.match(f.queue(), /^ERROR:.*link/i); assert.equal(encoded(f).length, 0);
});
test('unsupported native link collections expose bounded read-only diagnostics', () => {
  for (const returned of [undefined, false, 0, '0', { numItems: '0' }, {}]) {
    const v = clip('v', 'Video', 0, 4), a = clip('a', 'Audio', 0, 4);
    v.getLinkedItems = () => returned;
    a.getLinkedItems = () => ({ numItems: 1, 0: v });
    const f = fixture([[v]], [[a]]);
    const before = [f.seq.inValue.ticks, f.seq.outValue.ticks, v.disabled, a.disabled];
    const result = f.preview('all');
    assert.match(result, /^ERROR: Cannot inspect clip link collection/);
    assert.match(result, /LINK-DIAG-v1/);
    assert.match(result, /V1\.1.*type=/);
    assert.match(result, /A1\.1.*numItems=number:1.*indexedIds=v/);
    assert.deepEqual([f.seq.inValue.ticks, f.seq.outValue.ticks, v.disabled, a.disabled], before);
    assert.equal(f.project.sequences.length, 1);
    assert.equal(f.calls.length, 0);
    assert.match(f.queue('all'), /^ERROR:/);
    assert.equal(f.calls.length, 0);
  }
});
test('Premiere 26 null link results keep matching but unlinked AV as separate jobs', () => {
  const v = clip('v', 'Video', 0, 4), a = clip('a', 'Audio', 0, 4);
  v.getLinkedItems = a.getLinkedItems = () => null;
  const f = fixture([[v]], [[a]]);
  assert.match(f.preview('all'), /1 video, 1 audio/);
  assert.match(f.queue('all'), /Queued 2/);
});
test('a null reciprocal result cannot confirm another clip reported an AV link', () => {
  const v = clip('v', 'Video', 0, 4), a = clip('a', 'Audio', 0, 4);
  v.getLinkedItems = () => ({ numItems: 2, 0: v, 1: a });
  a.getLinkedItems = () => null;
  const f = fixture([[v]], [[a]]);
  assert.match(f.queue('all'), /^ERROR:.*links are inconsistent/);
  assert.equal(f.calls.length, 0);
});
test('plain native indexed collections and arrays both preserve actual AV linkage', () => {
  for (const shape of ['indexed', 'array']) {
    const v = clip('v', 'Video', 0, 4), a = clip('a', 'Audio', 0, 4);
    v.getLinkedItems = () => shape === 'indexed' ? { numItems: 1, 0: a } : [a];
    a.getLinkedItems = () => shape === 'indexed' ? { numItems: 1, 0: v } : [v];
    const f = fixture([[v]], [[a]]);
    assert.match(f.preview('all'), /1 video, 0 audio/);
  }
});
test('unknown linked identity and duplicate track identities are blocked', () => {
  const v = clip('v', 'Video', 0, 4); v.links = [clip('not-in-sequence', 'Audio', 0, 4)];
  assert.match(fixture([[v]]).queue(), /^ERROR:.*ident/i);
  assert.match(fixture([[clip('dup', 'Video', 0, 4)]], [[clip('dup', 'Audio', 0, 4)]]).queue(), /^ERROR:.*ident/i);
});
test('nonreciprocal reported links are blocked', () => {
  const v = clip('v', 'Video', 0, 4), a = clip('a', 'Audio', 0, 4); v.links = [a];
  assert.match(fixture([[v]], [[a]]).queue(), /^ERROR:.*link/i);
});
test('a link group with multiple videos is blocked instead of compositing', () => {
  const v1 = clip('v1', 'Video', 0, 4), v2 = clip('v2', 'Video', 0, 4); linked(v1, v2);
  assert.match(fixture([[v1], [v2]]).queue(), /^ERROR:.*multiple video/i);
});
test('audio-only linked groups need a user decision and are not silently merged', () => {
  const a1 = clip('a1', 'Audio', 0, 4), a2 = clip('a2', 'Audio', 0, 4); linked(a1, a2);
  assert.match(fixture([], [[a1], [a2]]).queue(), /^ERROR:.*audio-only link/i);
});
test('separate audio uses its own sample-based trimmed range and audio preset', () => {
  const a = clip('a', 'Audio', 1 + 1 / 48000, 2 + 2 / 48000, { sourceIn: 7, sourceOut: 8 + 1 / 48000 });
  const f = fixture([], [[a]]); assert.match(f.queue(), /Queued 1/);
  const call = encoded(f)[0]; assert.equal(call[3], '/audio.epr'); assert.match(call[2], /\.wav$/);
  assert.equal(call[1].getInPointAsTime().ticks, a.start.ticks);
  assert.equal(call[1].getOutPointAsTime().ticks, a.end.ticks);
});
test('Premiere rounding audio boundaries blocks queueing rather than truncating samples', () => {
  const f = fixture([], [[clip('a', 'Audio', 1 + 1 / 48000, 2 + 2 / 48000)]], { roundAudio: true });
  assert.match(f.queue(), /^ERROR:.*boundar/i); assert.equal(encoded(f).length, 0);
});
test('valid clones enqueue while another clone fails exact boundary validation', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]], [[clip('a', 'Audio', 1 + 1 / 48000, 2)]], { roundAudio: true });
  assert.match(f.queue(), /Skipped 1/); assert.equal(encoded(f).length, 1);
});
test('silent isolation failure and mismatched source trim are blocked', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)], [clip('other', 'Video', 0, 4, { selected: false })]], [], { disableFails: true });
  assert.match(f.queue(), /^ERROR:.*isolat/i); assert.equal(encoded(f).length, 0);
  assert.match(fixture([[clip('v', 'Video', 0, 4)]], [], { cloneMismatch: true }).queue(), /^ERROR:.*clone/i);
});
test('video-frame misalignment and overlapping transitions are blocked', () => {
  assert.match(fixture([[clip('v', 'Video', 1 + 1 / 48000, 4)]]).queue(), /^ERROR:.*frame/i);
  const f = fixture([[clip('v', 'Video', 0, 4)]]);
  f.seq.videoTracks[0].transitions = collection([{ start: time(0), end: time(1) }]);
  assert.match(f.queue(), /^ERROR:.*transition/i);
});
test('audio preset accidentally using a video container is blocked', () => {
  const f = fixture([], [[clip('a', 'Audio', 0, 4)]]);
  f.seq.getExportFileExtension = () => 'mp4';
  assert.match(f.queue(), /^ERROR:.*audio.*preset/i); assert.equal(encoded(f).length, 0);
});
test('changing output folder allows a separate intentional batch', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]]);
  f.queue(); f.dirs.add('/out-other'); f.context.exportClipsAsFiles('/out-other','/video.epr','/audio.epr','selected');
  assert.notEqual(encoded(f)[0][2], encoded(f)[1][2]);
  assert.equal(encoded(f)[0][6], false);
});
test('AME rejection reports partial queueing and restores the active sequence', () => {
  const f = fixture([[clip('v1', 'Video', 0, 4), clip('v2', 'Video', 4, 8)]], [], { rejectAfter: 1 });
  const result = f.queue(); assert.match(result, /^ERROR:/); assert.match(result, /Queued 1 of 2/);
  assert.equal(f.project.activeSequence, f.seq);
  assert.equal(f.seq.inValue.seconds, 2); assert.equal(f.seq.outValue.seconds, 8);
});
test('AME exceptions preserve original points and never start any queue', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]], [], { queueThrows: true });
  assert.match(f.queue(), /^ERROR:.*AME disconnected/);
  assert.equal(f.project.activeSequence, f.seq); assert.equal(f.seq.inValue.seconds, 2);
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 0);
});
test('clone hosts returning boolean are resolved by new sequence identity', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]], [], { cloneBoolean: true });
  assert.match(f.queue(), /Queued 1/); assert.notEqual(encoded(f)[0][1].sequenceID, 'original');
});
test('legacy successful AME launch return code zero does not discard valid jobs', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]], [], { legacyLaunch: true });
  assert.match(f.queue(), /Queued 1/);
});
test('unknown original or cloned mute states cannot prove safe isolation', () => {
  for (const state of [undefined, null, 'false', 2]) {
    const f = fixture([[clip('v', 'Video', 0, 4)]]);
    f.seq.videoTracks[0].isMuted = () => state;
    assert.match(f.queue(), /^ERROR:.*mute state/i); assert.equal(encoded(f).length, 0);
  }
  const f = fixture([[clip('v', 'Video', 0, 4)]], [], { badCloneMute: true });
  assert.match(f.queue(), /^ERROR:.*mute state/i); assert.equal(encoded(f).length, 0);
});
test('a reopen acknowledgement must actually restore the original active sequence', () => {
  const f = fixture([[clip('v', 'Video', 0, 4)]], [], { reopenNoOp: true });
  assert.match(f.queue(), /^ERROR:.*active sequence/i); assert.equal(encoded(f).length, 0);
});
test('unknown source classification and missing video adjustment detection are blocked', () => {
  const nested = clip('v', 'Video', 0, 4, { nested: true }); nested.projectItem.isSequence = () => undefined;
  assert.match(fixture([[nested]]).queue(), /^ERROR:.*nested/i);
  const adjustment = clip('v', 'Video', 0, 4, { adjustment: true }); delete adjustment.isAdjustmentLayer;
  assert.match(fixture([[adjustment]]).queue(), /^ERROR:.*adjustment/i);
});
test('linked J/L cuts and multiple audio members retain their whole trimmed group', () => {
  const v = clip('v', 'Video', 1, 5), a1 = clip('a1', 'Audio', 0, 5), a2 = clip('a2', 'Audio', 1, 6);
  linked(v, a1, a2); const f = fixture([[v]], [[a1], [a2]]);
  assert.match(f.preview(), /1 video, 0 audio/); assert.match(f.queue(), /Queued 1/);
  const copy = encoded(f)[0][1]; assert.equal(copy.inValue.seconds, 0); assert.equal(copy.outValue.seconds, 6);
  assert.equal(copy.audioTracks[0].clips[0].disabled, false); assert.equal(copy.audioTracks[1].clips[0].disabled, false);
});
test('supplied test1 stored boundaries produce the expected five isolated jobs', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/test1-boundaries.json'), 'utf8').replace(/^\uFEFF/, ''));
  const items = {}, videos = [[], [], []], audios = [[], [], []];
  for (const r of data.clips) {
    const item = clip(r.id, r.kind, Number(r.start) / Number(TPS), Number(r.end) / Number(TPS));
    item.start = time(r.start); item.end = time(r.end);
    item.inPoint = time(r.sourceIn); item.outPoint = time(r.sourceOut);
    items[r.id] = item; (r.kind === 'Video' ? videos : audios)[r.track].push(item);
  }
  for (const ids of data.explicitStoredLinks) linked(...ids.map(id => items[id]));
  const f = fixture(videos, audios); f.seq.timebase = data.frameTicks;
  assert.match(f.preview('all'), /4 video, 1 audio/); assert.match(f.queue('all'), /Queued 5/);
  const copies = encoded(f).map(call => call[1]);
  assert.equal(copies.length, 5);
  const second = copies.find(copy => copy.inValue.ticks === items['75'].start.ticks);
  assert.equal(second.videoTracks[1].clips[0].disabled, false);
  assert.equal(second.videoTracks[0].clips[0].disabled, true);
  assert.equal(second.videoTracks[0].clips[1].disabled, true);
  assert.equal(second.audioTracks[1].clips[0].disabled, false);
  assert.equal(second.audioTracks[0].clips[1].disabled, true);
  assert.equal(second.videoTracks[1].clips[0].inPoint.ticks, '46048020480000');
  const independent = encoded(f).find(call => call[3] === '/audio.epr')[1];
  assert.equal(independent.inValue.ticks, '79588293120000');
  assert.equal(independent.outValue.ticks, '129040128000000');
  assert.equal(independent.audioTracks[0].clips[1].inPoint.ticks, '115689047040000');
  assert.ok(independent.videoTracks.every(track => track.clips.every(item => item.disabled)));
});
test('actual Premiere 26 self-inclusive collections and nulls produce five isolated test1 jobs', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/test1-boundaries.json'), 'utf8').replace(/^\uFEFF/, ''));
  const observed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/premiere26-link-collections.json'), 'utf8'));
  const items = {}, videos = [[], []], audios = [[], []];
  for (const r of data.clips) {
    const id = observed.storedToNativeId[r.id];
    const item = clip(id, r.kind, 0, 1);
    item.start = time(r.start); item.end = time(r.end);
    item.inPoint = time(r.sourceIn); item.outPoint = time(r.sourceOut);
    items[id] = item; (r.kind === 'Video' ? videos : audios)[r.track].push(item);
  }
  for (const record of observed.results) {
    items[record.id].getLinkedItems = () => {
      if (record.links === null) return null;
      const result = { numItems: record.numItems, length: record.length, numTracks: record.numTracks,
        reflect: { name: 'TrackItemCollection' }, [Symbol.toStringTag]: 'TrackItemCollection' };
      record.links.forEach((id, i) => result[i] = items[id]);
      return result;
    };
  }
  const f = fixture(videos, audios); f.seq.timebase = data.frameTicks;
  const before = [f.seq.inValue.ticks, f.seq.outValue.ticks];
  assert.match(f.preview('all'), /Planned 5 jobs: 4 video, 1 audio/);
  assert.equal(f.calls.length, 0); assert.equal(f.project.sequences.length, 1);
  assert.match(f.queue('all'), /Queued 5/);
  assert.equal(encoded(f).filter(call => call[3] === '/video.epr').length, 4);
  assert.equal(encoded(f).filter(call => call[3] === '/audio.epr').length, 1);
  const groups = encoded(f).map(call => [call[1].videoTracks, call[1].audioTracks]
    .flatMap(tracks => tracks.flatMap(track => track.clips.filter(item => !item.disabled)
      .map(item => item.nodeId.replace(/^copy-\d+-/, '')))).sort().join(','));
  assert.deepEqual(groups.sort(), [
    '000f4242,000f4247', '000f4244', '000f4245,000f4249', '000f4246,000f424a', '000f4248',
  ].sort());
  assert.ok(Object.values(items).every(item => item.disabled === false));
  assert.deepEqual([f.seq.inValue.ticks, f.seq.outValue.ticks], before);
  assert.equal(f.project.activeSequence, f.seq);
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 0);
});

test('numeric zero source identity is preserved rather than treated as absent', () => {
 const item=clip('v','Video',0,4);item.projectItem.nodeId=0;
 const f=fixture([[item]]);assert.match(f.preview('all'),/Planned 1/);assert.match(f.queue('all'),/Queued 1/);
 assert.equal(encoded(f).length,1);
});
test('source failure follows earlier ticks with source-stage location instead of stale time-stage', () => {
 const ok=clip('v1','Video',0,4),bad=clip('v2','Video',4,8);bad.projectItem=null;
 const f=fixture([[ok,bad]]);f.context.$={global:{__MarkerExportTrace:{id:'test',lines:[]}}};
 const result=f.preview('all');assert.match(result,/stage=source/);assert.match(result,/location=V1\.2/);assert.match(result,/reason=source-null/);
 assert.equal(f.calls.length,0);assert.equal(f.project.sequences.length,1);assert.equal(ok.disabled,false);
 assert.doesNotMatch(result,/source.mov|Test original/);
});
test('missing source identity is diagnosed distinctly without guessing matching names', () => {
 const first=clip('v1','Video',0,4),second=clip('v2','Video',4,8);delete second.projectItem.nodeId;
 const f=fixture([[first,second]]);const result=f.preview('all');assert.match(result,/reason=node-id-unavailable/);assert.match(result,/nodeIdType=undefined/);assert.match(result,/location=V1\.2/);assert.equal(f.calls.length,0);
});
test('source getter throwing refuses export and identifies actual failing getter', () => {
 const bad=clip('v1','Video',0,4);Object.defineProperty(bad,'projectItem',{get(){throw Error('private-file-name')}});
 const f=fixture([[bad]]);f.context.$={global:{__MarkerExportTrace:{id:'test',lines:[]}}};const result=f.queue('all');assert.match(result,/reason=source-getter-threw/);assert.match(result,/call=TrackItem.projectItem/);assert.doesNotMatch(result,/private-file-name/);assert.equal(encoded(f).length,0);
});
test('project item nodeId getter throwing is not confused with time getter', () => {
 const bad=clip('v1','Video',0,4);Object.defineProperty(bad.projectItem,'nodeId',{get(){throw Error('private')}});
 const f=fixture([[bad]]);f.context.$={global:{__MarkerExportTrace:{id:'test',lines:[]}}};assert.match(f.preview('all'),/call=ProjectItem.nodeId/);assert.equal(f.calls.length,0);
});
test('offline sources retain blocking classification', () => {
 const offline=clip('v1','Video',0,4);offline.projectItem.isOffline=()=>true;
 const f=fixture([[offline]]);assert.match(f.queue('all'),/offline/);assert.equal(encoded(f).length,0);
});
test('preview retains the directly returned source instead of rereading a changing host getter', () => {
 const item=clip('v1','Video',0,4),source=item.projectItem;let reads=0;
 Object.defineProperty(item,'projectItem',{get(){reads++;return reads===1?source:null;}});
 const f=fixture([[item]]);assert.match(f.preview('all'),/Planned 1/);assert.equal(reads,1);assert.equal(f.calls.length,0);
});
test('source nodeId getter is read once per inventory record', () => {
 const item=clip('v1','Video',0,4);let reads=0;
 Object.defineProperty(item.projectItem,'nodeId',{get(){reads++;return reads===1?'real-source':undefined;}});
 const f=fixture([[item]]);assert.match(f.preview('all'),/Planned 1/);assert.equal(reads,1);assert.equal(f.calls.length,0);
});
test('changed cloned source identity still blocks all queue submissions', () => {
 const f=fixture([[clip('v1','Video',0,4)]]),originalClone=f.seq.clone;
 f.seq.clone=function(){const copy=originalClone();copy.videoTracks[0].clips[0].projectItem={nodeId:'different-source',isSequence:()=>false,getMediaPath:()=>'/media/source.mov'};return copy;};
 assert.match(f.queue('all'),/Clone does not preserve/);assert.equal(encoded(f).length,0);assert.equal(f.calls.length,0);
});
test('an actual ticks getter failure retains time-stage after valid source resolution', () => {
 const item=clip('v1','Video',0,4);Object.defineProperty(item.start,'ticks',{get(){throw Error('ticks unavailable');}});
 const f=fixture([[item]]);f.context.$={global:{__MarkerExportTrace:{id:'test',lines:[]}}};
 const result=f.preview('all');assert.match(result,/stage=time call=Time.ticks/);assert.doesNotMatch(result,/Cannot identify/);assert.equal(f.calls.length,0);
});

test('B04 mixed bad source continues and disables bad slot in healthy export',()=>{
 const good=clip('good','Video',0,4),bad=clip('bad','Video',4,8);bad.projectItem=null;
 const f=fixture([[good,bad]]);assert.match(f.preview('all'),/Skipped 1/);
 const result=f.queue('all');assert.match(result,/Queued 1/);assert.match(result,/Skipped 1/);assert.match(result,/V1\.2/);
 assert.equal(encoded(f).length,1);assert.equal(encoded(f)[0][1].videoTracks[0].clips[1].disabled,true);
});
test('B04 retry after accepted submission survives host reload without duplicate',()=>{
 const f=fixture([[clip('good','Video',0,4)]]);f.queue();
 vm.runInContext(fs.readFileSync(path.join(ROOT,'com.texs.markerexport/host/export-markers.jsx'),'utf8'),f.context);
 assert.match(f.queue(),/already submitted/);assert.equal(encoded(f).length,1);
});
test('B04 first submission rejection does not prevent subsequent healthy submission',()=>{
 const f=fixture([[clip('one','Video',0,4),clip('two','Video',4,8)]]);
 let n=0;f.context.app.encoder.encodeSequence=(...args)=>{f.calls.push(['encode',...args]);return ++n===1?'0':'accepted';};
 const result=f.queue();assert.match(result,/Queued 1 of 2/);assert.match(result,/Failed 1/);assert.equal(encoded(f).length,2);
 f.queue();assert.equal(encoded(f).length,3); // Only the rejected item is retried.
});
test('B04 uncertain submission is not duplicated on retry',()=>{
 const f=fixture([[clip('one','Video',0,4)]],[],{queueThrows:true});
 assert.match(f.queue(),/Failed 1/);assert.match(f.queue(),/already submitted/);assert.equal(encoded(f).length,1);
});
test('B04 all unparseable clips report locations and never launch AME',()=>{
 const a=clip('one','Video',0,4),b=clip('two','Video',4,8);a.projectItem=b.projectItem=null;
 const f=fixture([[a,b]]);const r=f.queue('all');assert.match(r,/Skipped 2/);assert.match(r,/V1\.1/);assert.match(r,/V1\.2/);assert.equal(f.calls.length,0);
});

test('B04 invalid linked AV skips the entire group while independent audio continues',()=>{
 const v=clip('v','Video',0,4),a=clip('a','Audio',0,4),independent=clip('solo','Audio',4,8);linked(v,a);a.projectItem=null;
 const f=fixture([[v]],[[a,independent]]);const r=f.queue('all');assert.match(r,/Queued 1/);assert.match(r,/Skipped 1/);assert.match(r,/V1\.1.*A1\.1/);
 assert.equal(encoded(f)[0][3],'/audio.epr');assert.equal(encoded(f)[0][1].videoTracks[0].clips[0].disabled,true);assert.equal(encoded(f)[0][1].audioTracks[0].clips[0].disabled,true);
});
test('B04 time parsing failure preserves slot and does not stop valid item',()=>{
 const bad=clip('bad','Video',0,4),good=clip('good','Video',4,8);bad.start.ticks='invalid';
 const f=fixture([[bad,good]]);assert.match(f.queue('all'),/Skipped 1/);assert.equal(encoded(f).length,1);assert.equal(encoded(f)[0][1].videoTracks[0].clips[0].disabled,true);
});
test('B04 global missing preset blocks entire batch without creating copies',()=>{
 const f=fixture([[clip('one','Video',0,4),clip('two','Video',4,8)]]);f.files.delete('/video.epr');assert.match(f.queue(),/^ERROR:.*preset/i);assert.equal(f.project.sequences.length,1);assert.equal(f.calls.length,0);
});
test('B04 all explicitly rejected submissions report failures and continue attempts',()=>{
 const f=fixture([[clip('one','Video',0,4),clip('two','Video',4,8)]],[],{rejectAfter:0});const r=f.queue();assert.match(r,/Queued 0 of 2/);assert.match(r,/Failed 2/);assert.match(r,/V1\.1/);assert.match(r,/V1\.2/);assert.equal(encoded(f).length,2);
});

test('B05 numeric zero is enabled and numeric one remains disabled',()=>{
 const good=clip('good','Video',0,4),bad=clip('bad','Video',4,8);good.disabled=0;bad.disabled=1;
 const f=fixture([[good,bad]]);const r=f.queue('all');assert.match(r,/Queued 1/);assert.equal(encoded(f).length,1);assert.equal(good.disabled,0);assert.equal(bad.disabled,1);
});
test('B05 PR15 undefined disabled uses snapshot and removes unrelated clones only',()=>{
 const v=clip('v','Video',0,4),a=clip('a','Audio',0,4),solo=clip('solo','Audio',4,8),off=clip('off','Video',8,12);linked(v,a);
 for(const item of [v,a,solo,off])delete item.disabled;off.legacyDisabled=true;
 const f=fixture([[v,off]],[[a,solo]],{version:'15.4.1'});const r=f.queue('all');assert.match(r,/Queued 2/);assert.match(r,/Skipped 1/);
 assert.equal(encoded(f).length,2);assert.equal(f.seq.videoTracks[0].clips.length,2);assert.equal(f.seq.audioTracks[0].clips.length,2);assert.equal(v.disabled,undefined);assert.equal(off.disabled,undefined);
 assert.equal(encoded(f)[0][1].videoTracks[0].clips.length,1);assert.equal(encoded(f)[0][1].audioTracks[0].clips.length,1);
 assert.equal(encoded(f)[1][1].videoTracks[0].clips.length,0);assert.equal(encoded(f)[1][1].audioTracks[0].clips.length,1);
 assert(f.calls.filter(c=>c[0]==='remove').every(c=>c[2]===false&&c[3]===false));assert.equal(f.project.activeSequence,f.seq);assert.equal(f.seq.inValue.seconds,2);
});
test('B05 unavailable state is never misreported as disabled',()=>{
 const item=clip('v','Video',0,4);delete item.disabled;const f=fixture([[item]],[],{version:'15.4.1',xmlCorrupt:true});
 const r=f.queue('all');assert.match(r,/Cannot inspect clip enabled state/);assert.doesNotMatch(r,/A requested linked clip is disabled/);assert.equal(encoded(f).length,0);
});
test('B05 source-null keeps original source trace without collection rewrapping',()=>{
 const good=clip('good','Video',0,4),graphic=clip('graphic','Video',4,8);graphic.projectItem=null;
 const f=fixture([[good,graphic]]);f.context.$.global.__MarkerExportTrace={id:'trace',lines:[]};const r=f.preview('all');
 assert.match(r,/stage=source call=TrackItem.projectItem/);assert.doesNotMatch(r,/stage=collection call=TrackItem.getLinkedItems.*source-null/);assert.equal((r.match(/name=Error message=Cannot identify/g)||[]).length,1);
});
test('B05 PR15 remove failure restores original state and queues no unsafe copy',()=>{
 const v=clip('v','Video',0,4),other=clip('other','Video',4,8);delete v.disabled;delete other.disabled;
 const f=fixture([[v,other]],[],{version:'15.4.1',removeThrows:true});const r=f.queue('all');assert.match(r,/Skipped 2/);assert.equal(encoded(f).length,0);assert.equal(f.project.activeSequence,f.seq);assert.equal(f.seq.videoTracks[0].clips.length,2);assert.equal(f.seq.inValue.seconds,2);assert.equal(f.seq.outValue.seconds,8);
});
test('B05 PR15 silent removal failure fails isolation verification',()=>{
 const v=clip('v','Video',0,4),other=clip('other','Video',4,8);delete v.disabled;delete other.disabled;
 const f=fixture([[v,other]],[],{version:'15.4.1',removeNoOp:true});assert.match(f.queue('all'),/isolation/i);assert.equal(encoded(f).length,0);
});
test('B05 missing snapshot blocks state inference without changing original',()=>{
 const v=clip('v','Video',0,4);delete v.disabled;const f=fixture([[v]],[],{version:'15.4.1',xmlThrows:true});const r=f.queue('all');assert.match(r,/snapshot failed/);assert.equal(f.calls.length,0);assert.equal(f.project.sequences.length,1);assert.equal(v.disabled,undefined);
});
test('B05 PR15 stereo snapshot channels preserve independent audio tasks',()=>{
 const a=clip('wav','Audio',0,4),b=clip('mp3','Audio',4,8);delete a.disabled;delete b.disabled;
 const f=fixture([],[[a],[b]],{version:'15.4.1',xmlStereo:true});assert.match(f.queue('all'),/Queued 2/);assert.equal(encoded(f).length,2);assert.equal(f.seq.audioTracks[0].clips.length,1);
});
test('B05 conflicting snapshot channel states are rejected without guessing',()=>{
 const a=clip('wav','Audio',0,4);delete a.disabled;const f=fixture([],[[a]],{version:'15.4.1',xmlStereo:true,xmlChannelConflict:true});assert.match(f.queue(),/Cannot inspect clip enabled state/);assert.equal(encoded(f).length,0);
});
test('B05 omitted unsupported graphic remains local on PR15',()=>{
 const good=clip('video','Video',0,4),graphic=clip('graphic','Video',4,8);delete good.disabled;delete graphic.disabled;graphic.projectItem=null;
 const f=fixture([[good,graphic]],[],{version:'15.4.1',xmlOmit:'graphic'});const r=f.queue('all');assert.match(r,/Queued 1/);assert.match(r,/Skipped 1/);assert.match(r,/source-null/);assert.equal(encoded(f)[0][1].videoTracks[0].clips.length,1);assert.equal(f.seq.videoTracks[0].clips.length,2);
});
test('B05 shared clone items are rejected before mutating original timeline',()=>{
 const v=clip('v','Video',0,4),other=clip('other','Video',4,8,{selected:false});const f=fixture([[v,other]]);const create=f.seq.clone;
 f.seq.clone=()=>{const copy=create();copy.videoTracks[0].clips=f.seq.videoTracks[0].clips;return copy;};assert.match(f.queue(),/shares original timeline objects/);assert.equal(v.disabled,false);assert.equal(other.disabled,false);assert.equal(encoded(f).length,0);assert.equal(f.project.activeSequence,f.seq);
});
test('B05 unsupported scalar enabled states remain unknown rather than disabled',()=>{
 for(const value of [null,'0','false',2,{}]){const v=clip('v','Video',0,4);v.disabled=value;const f=fixture([[v]]);const r=f.queue();assert.match(r,/Cannot inspect clip enabled state/);assert.doesNotMatch(r,/A requested linked clip is disabled/);assert.equal(encoded(f).length,0);}
});
test('B05 empty shared tracks are rejected before mutating original mute state',()=>{
 const v=clip('v','Video',0,4);const f=fixture([[v]], [[]]);const create=f.seq.clone;f.seq.clone=()=>{const copy=create();copy.audioTracks[0]=f.seq.audioTracks[0];return copy;};assert.match(f.queue(),/shares original timeline objects/);assert.equal(f.seq.audioTracks[0].muted,false);assert.equal(encoded(f).length,0);
});
test('B05 PR15 snapshot files are removed after preview',()=>{
 const v=clip('v','Video',0,4);delete v.disabled;const f=fixture([[v]],[],{version:'15.4.1'});assert.match(f.preview(),/Planned 1/);assert.equal([...f.files].filter(p=>p.includes('MarkerExport-state')).length,0);assert.equal([...f.dirs].filter(p=>p.includes('MarkerExport-state')).length,0);assert.equal(f.project.sequences.length,1);
});
test('B05 legacy retained trim mutation after removal never reaches AME',()=>{
 const v=clip('v','Video',0,4),a=clip('a','Video',4,8);delete v.disabled;delete a.disabled;const f=fixture([[v,a]],[],{version:'15.4.1'});const create=f.seq.clone;
 f.seq.clone=()=>{const copy=create();for(const item of copy.videoTracks[0].clips){const remove=item.remove;item.remove=function(...args){const result=remove.apply(this,args);const retained=copy.videoTracks[0].clips[0];if(retained)retained.inPoint=time(99);return result;};}return copy;};assert.match(f.queue(),/changed retained clip/);assert.equal(encoded(f).length,0);assert.equal(v.inPoint.seconds,30);assert.equal(f.project.activeSequence,f.seq);
});

test('B06 PR15 sample-aligned audio receives explicit snapshot state without video-frame rounding export',()=>{
 const a=clip('audio','Audio',1+1/48000,2+2/48000);delete a.disabled;const f=fixture([],[[a]],{version:'15.4.1'});const r=f.queue();assert.match(r,/Queued 1/);assert.equal(encoded(f)[0][1].inValue.ticks,a.start.ticks);assert.equal(encoded(f)[0][1].outValue.ticks,a.end.ticks);assert.equal(a.disabled,undefined);
});
test('B06 subframe linked audio does not remove the entire legitimate AV group in preview',()=>{
 const v=clip('video','Video',1,4),a=clip('audio','Audio',1+1/48000,4);linked(v,a);delete v.disabled;delete a.disabled;const f=fixture([[v]],[[a]],{version:'15.4.1'});assert.match(f.preview(),/Planned 1 jobs: 1 video/);assert.match(f.queue(),/Queued 1/);
});
test('B06 same source split into many different positions is not collapsed by snapshot matching',()=>{
 const items=Array.from({length:60},(_,i)=>clip('audio-'+i,'Audio',i*4+1/48000,i*4+2+1/48000));items.forEach(i=>delete i.disabled);const f=fixture([], [items],{version:'15.4.1'});assert.match(f.preview('all'),/Planned 60 jobs/);assert.match(f.preview('all'),/Skipped 0/);
});
test('B06 native source trim can be verified from explicit XML source frame fields when tick fields absent',()=>{
 const v=clip('video','Video',0,4);delete v.disabled;const f=fixture([[v]],[],{version:'15.4.1',xmlSourceFrames:true});assert.match(f.preview(),/Planned 1 jobs/);assert.match(f.queue(),/Queued 1/);
});
test('B06 absent source anchors remain unknown and are never guessed enabled',()=>{
 const v=clip('video','Video',0,4);delete v.disabled;const f=fixture([[v]],[],{version:'15.4.1',xmlMissingPproTicks:true});const r=f.preview();assert.match(r,/Cannot inspect clip enabled state/);assert.equal(encoded(f).length,0);
});
test('B06 ambiguous native frame serialization cannot claim a unique enabled state',()=>{
 const a=clip('a','Audio',1,1.01,{sourceIn:0,sourceOut:.01}),b=clip('b','Audio',1.02,1.03,{sourceIn:0,sourceOut:.01});delete a.disabled;delete b.disabled;const f=fixture([],[[a,b]],{version:'15.4.1'});const r=f.queue();assert.match(r,/Cannot inspect clip enabled state/);assert.equal(encoded(f).length,0);
});
test('B06 explicit FALSE remains disabled on sample-aligned audio',()=>{
 const a=clip('a','Audio',1+1/48000,2),b=clip('b','Audio',4+1/48000,5);delete a.disabled;delete b.disabled;a.legacyDisabled=true;const f=fixture([],[[a,b]],{version:'15.4.1'});const r=f.queue('all');assert.match(r,/Queued 1/);assert.match(r,/Skipped 1/);assert.match(r,/A requested linked clip is disabled/);assert.equal(encoded(f).length,1);
});
test('B06 duplicate file references cannot merge different native timeline clips',()=>{
 const a=clip('one','Video',0,4),b=clip('two','Video',4,8);delete a.disabled;delete b.disabled;const f=fixture([[a,b]],[],{version:'15.4.1',xmlFileReferences:true});assert.match(f.preview('all'),/Planned 2 jobs/);assert.match(f.queue('all'),/Queued 2/);assert.equal(encoded(f).length,2);
});
test('B06 mismatching explicit source ticks are not ignored and expose precise reason',()=>{
 const a=clip('one','Video',0,4);delete a.disabled;const f=fixture([[a]],[],{version:'15.4.1',xmlWrongSourceTicks:true});const r=f.preview();assert.match(r,/reason=source-anchor-mismatch/);assert.match(r,/xmlTicksIn=999/);assert.match(r,/nativeSource=/);assert.equal(encoded(f).length,0);
});
test('B06 preview distinguishes all timeline clips from genuine linked tasks',()=>{
 const v=clip('v','Video',0,4),a=clip('a','Audio',0,4),solo=clip('solo','Audio',4,8);linked(v,a);const f=fixture([[v]],[[a,solo]]);const r=f.preview('all');assert.match(r,/Timeline inventory: 3 clips/);assert.match(r,/Planned 2 jobs/);assert.match(r,/scope=all/);
});

test('B07 nested instance uses source sequence name and needs no media file path',()=>{
 const v=clip('nest','Video',4,8,{nested:true,name:'Renamed instance',sourceName:'底.v2',sourceIn:20,sourceOut:22,speed:2});
 v.projectItem.getMediaPath=()=>{throw Error('A sequence has no file path')};
 const f=fixture([[v]]);assert.match(f.preview('all'),/Planned 1 jobs/);assert.match(f.preview('all'),/底\.v2/);assert.doesNotMatch(f.preview('all'),/Renamed instance\.mp4/);
 assert.match(f.queue('all'),/Queued 1/);const q=encoded(f)[0];assert.notEqual(q[1],f.seq);assert.equal(q[1].getInPointAsTime().ticks,time(4).ticks);assert.equal(q[1].getOutPointAsTime().ticks,time(8).ticks);assert.equal(q[4],1);assert.equal(q[6],false);assert.equal(f.calls.filter(x=>x[0]==='start').length,0);
});
test('B07 nested AV retains source reference, outer effects and speed while isolating other tracks',()=>{
 const effect={matchName:'AE.ADBE Motion',displayName:'Motion',properties:{opaqueKeyframes:[1,2]}};
 const v=clip('nest','Video',4,8,{nested:true,speed:2,reversed:true,components:[effect]}),a=clip('nested-a','Audio',4,8,{nested:true}),otherV=clip('other-v','Video',4,8,{selected:false}),otherA=clip('other-a','Audio',4,8,{selected:false});linked(v,a);
 const f=fixture([[v],[otherV]],[[a],[otherA]]);assert.match(f.queue(),/Queued 1/);const c=encoded(f)[0][1];
 assert.equal(c.videoTracks[0].clips[0].projectItem,v.projectItem);assert.equal(c.videoTracks[0].clips[0].getSpeed(),2);assert.equal(c.videoTracks[0].clips[0].isSpeedReversed(),true);assert.deepEqual(c.videoTracks[0].clips[0].components[0],effect);
 assert.equal(c.videoTracks[0].clips[0].disabled,false);assert.equal(c.audioTracks[0].clips[0].disabled,false);assert.equal(c.videoTracks[1].clips[0].disabled,true);assert.equal(c.audioTracks[1].clips[0].disabled,true);assert.equal(c.audioTracks[1].muted,true);assert.equal(otherV.disabled,false);assert.equal(otherA.disabled,false);
});
test('B07 multicam preserves opaque camera selection and switched audio on parent timeline copies',()=>{
 const v=clip('mc','Video',0,4,{multicam:true,sourceName:'Two cameras'}),a=clip('mc-a','Audio',0,4,{multicam:true});v.cameraState={chosen:2,cuts:[1,2,1]};a.cameraState={audioFollowsVideo:true,cuts:[1,2,1]};linked(v,a);
 const f=fixture([[v]],[[a]]);assert.match(f.preview(),/multicam/);assert.match(f.queue(),/Queued 1/);const c=encoded(f)[0][1];assert.deepEqual(c.videoTracks[0].clips[0].cameraState,v.cameraState);assert.deepEqual(c.audioTracks[0].clips[0].cameraState,a.cameraState);assert.equal(c.videoTracks[0].clips[0].projectItem,v.projectItem);
});
test('B07 same nested source at two timeline positions remains two independent jobs',()=>{
 const a=clip('n1','Video',0,4,{nested:true}),b=clip('n2','Video',4,8,{nested:true});b.projectItem=a.projectItem;
 const f=fixture([[a,b]]);assert.match(f.queue('all'),/Queued 2/);assert.equal(encoded(f).length,2);assert.notEqual(encoded(f)[0][2],encoded(f)[1][2]);
});
test('B07 standalone nested audio remains audio-only and linked multichannel AV remains one task',()=>{
 const a=clip('nested-a','Audio',0,4,{nested:true}),f=fixture([],[[a]]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][3],'/audio.epr');
 const v=clip('v','Video',0,4,{multicam:true}),a1=clip('a1','Audio',0,4,{multicam:true}),a2=clip('a2','Audio',0,4,{multicam:true});linked(v,a1,a2);const g=fixture([[v]],[[a1],[a2]]);assert.match(g.queue(),/Queued 1/);assert.equal(encoded(g)[0][1].audioTracks[1].clips[0].disabled,false);
});
test('B07 nested clone speed, kind or effect topology mismatch blocks before any queue submission',()=>{
 for(const mismatch of ['cloneSpeedMismatch','cloneKindMismatch','cloneEffectMismatch']){
 const v=clip('nested','Video',0,4,{nested:true,components:[{matchName:'AE.ADBE Motion',displayName:'Motion'}]});const f=fixture([[v]],[],{[mismatch]:true});assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);assert.equal(v.disabled,false);assert.match(f.queue(),/sequence.*state|render.*state/i);
 }
});
test('B07 unknown multicam classification or missing sequence name never falls back to source-file export',()=>{
 const v=clip('v','Video',0,4,{nested:true});v.projectItem.isMulticamClip=()=>undefined;assert.match(fixture([[v]]).preview(),/multicam/);
 const n=clip('n','Video',0,4,{nested:true});n.projectItem.name='';const f=fixture([[n]]);assert.match(f.queue(),/^ERROR:.*sequence.*name/i);assert.equal(encoded(f).length,0);
});
test('B07 older host may omit multicam classifier but must still prove nested speed and effects',()=>{
 const v=clip('v','Video',0,4,{nested:true});delete v.projectItem.isMulticamClip;const f=fixture([[v]]);assert.match(f.preview(),/Planned 1 jobs/);
 delete v.getSpeed;const g=fixture([[v]]);assert.match(g.queue(),/^ERROR:.*speed/i);assert.equal(encoded(g).length,0);
});
test('B07 legacy XML state route isolates nested AV on copy without changing nested source',()=>{
 const v=clip('nest','Video',0,4,{nested:true}),a=clip('a','Audio',0,4,{nested:true}),other=clip('other','Video',0,4,{selected:false});delete v.disabled;delete a.disabled;delete other.disabled;linked(v,a);
 const f=fixture([[v],[other]],[[a]],{version:'15.4.1'});assert.match(f.queue(),/Queued 1/);const c=encoded(f)[0][1];assert.equal(c.videoTracks[1].clips.length,0);assert.equal(c.videoTracks[0].clips[0].projectItem,v.projectItem);assert.equal(f.seq.videoTracks[1].clips.length,1);
});
test('B07 nested clip overlapping a parent transition remains an explicit skip',()=>{
 const f=fixture([[clip('n','Video',0,4,{nested:true})]]);f.seq.videoTracks[0].transitions=collection([{start:time(0),end:time(1)}]);assert.match(f.preview(),/transition/);assert.equal(encoded(f).length,0);
});
test('B07 zero-speed nested hold is retained and malformed speed is rejected',()=>{
 const held=clip('hold','Video',0,4,{nested:true,speed:0});const f=fixture([[held]]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][1].videoTracks[0].clips[0].getSpeed(),0);
 for(const speed of [NaN,Infinity,'1']){const bad=clip('bad','Video',0,4,{nested:true,speed});const g=fixture([[bad]]);assert.match(g.queue(),/^ERROR:.*speed/i);assert.equal(encoded(g).length,0);}
});
test('B07 count summary separates actual linked grouping from explicit skips',()=>{
 const v=clip('v','Video',0,4,{nested:true}),a=clip('a','Audio',0,4,{nested:true}),bad=clip('bad','Video',8,12);bad.disabled=true;linked(v,a);
 const f=fixture([[v,bad]],[[a]]),p=f.preview('all');assert.match(p,/Timeline inventory: 3 clips/);assert.match(p,/Task groups: 2; planned=1; skipped=1/);assert.match(p,/Sequence-source jobs: 1/);assert.match(p,/SKIP V1.2/);
});

function graphic(id,start=0,end=4,options={}){return clip(id,'Video',start,end,{graphic:true,name:'图形',components:[{matchName:'AE.ADBE Graphic Group',displayName:'矢量运动'},{matchName:'AE.ADBE Shape',displayName:'形状'}],...options});}
function transition(start,end,alignment,name='Native transition'){return {nodeId:'tr-'+start,matchName:'native.transition',name,type:2,start:time(start),end:time(end),xmlAlignment:alignment};}
test('B08 source-null native MGT graphics export with their own effects and exact trims',()=>{const g=graphic('g',61,63.04,{sourceIn:3600,sourceOut:3602.04}),under=clip('under','Video',0,100,{selected:false});g.nativeGraphicValues={shape:'opaque native data',keys:[1,2]};const f=fixture([[under],[g]]);assert.match(f.preview(),/1 video/);assert.match(f.queue(),/Queued 1/);const copy=encoded(f)[0][1];assert.equal(copy.videoTracks[1].clips[0].projectItem,null);assert.deepEqual(copy.videoTracks[1].clips[0].nativeGraphicValues,g.nativeGraphicValues);assert.equal(copy.videoTracks[0].clips[0].disabled,true);assert.equal(copy.inValue.ticks,g.start.ticks);assert.equal(copy.outValue.ticks,g.end.ticks);assert.match(encoded(f)[0][2],/图形\.mp4$/);assert.equal(g.disabled,false);});
test('B08 separate source-null graphics with identical names are not deduplicated',()=>{const f=fixture([[graphic('a'),graphic('b',4,8)]]);assert.match(f.queue('all'),/Queued 2/);assert.notEqual(encoded(f)[0][2],encoded(f)[1][2]);assert.match(f.queue('all'),/already submitted/);assert.equal(encoded(f).length,2);});
test('B08 source-null MGT preserves only actual reciprocal linked audio',()=>{const g=graphic('g'),a=clip('a','Audio',0,4);linked(g,a);const f=fixture([[g]],[[a],[clip('unrelated','Audio',0,4,{selected:false})]]);assert.match(f.queue(),/Queued 1/);const copy=encoded(f)[0][1];assert.equal(copy.audioTracks[0].clips[0].disabled,false);assert.equal(copy.audioTracks[1].clips[0].disabled,true);});
test('B08 null source is not enough: wrong type, missing or ambiguous MGT, and source getter errors stay blocked',()=>{for(const mutate of [g=>g.isMGT=()=>false,g=>g.isMGT=()=>undefined,g=>delete g.isMGT,g=>g.type=2,g=>g.mediaType='Audio',g=>Object.defineProperty(g,'projectItem',{get(){throw Error('unreadable')}})]){const g=graphic('g');mutate(g);const f=fixture([[g]]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);}});
test('B08 graphic clone identity or effect loss blocks only that job',()=>{for(const options of [{cloneGraphicMismatch:true},{cloneEffectMismatch:true}]){const f=fixture([[graphic('g')]],[],options);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);}});
test('B08 two actual disabled graphics remain skipped',()=>{const a=graphic('a'),b=graphic('b',4,8);a.disabled=b.disabled=true;const f=fixture([[a,b,graphic('ok',8,12)]]);assert.match(f.queue('all'),/Queued 1/);assert.equal(encoded(f).length,1);});
test('B08 single-sided tail fade remains native even when another clip is adjacent',()=>{const a=clip('a','Video',0,3),b=clip('b','Video',3,5,{selected:false}),f=fixture([[a,b]]);f.seq.videoTracks[0].transitions=collection([transition(2,3,'end-black')]);assert.match(f.preview(),/1 video/);assert.match(f.queue(),/Queued 1/);const copy=encoded(f)[0][1];assert.equal(copy.videoTracks[0].transitions[0].name,'Native transition');assert.equal(copy.videoTracks[0].clips[1].disabled,true);assert.equal(copy.outValue.ticks,time(3).ticks);});
test('B08 linked AV with stereo audio tail fade stays one video job',()=>{const v=clip('v','Video',0,3),a=clip('a','Audio',0,3);linked(v,a);const f=fixture([[v]],[[a]],{xmlStereo:true});f.seq.audioTracks[0].transitions=collection([transition(2,3,'end-black','恒定功率')]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][1].audioTracks[0].transitions[0].name,'恒定功率');assert.equal(encoded(f)[0][3],'/video.epr');});
test('B08 a native graphic head transition is retained, never reconstructed from XML effect names',()=>{const f=fixture([[graphic('g',61,63.04)]]);f.seq.videoTracks[0].transitions=collection([transition(61,62,'start-black','Pop Motion')]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][1].videoTracks[0].transitions[0].name,'Pop Motion');});
test('B08 dual-sided transitions explicitly skip because neighbor context is not implemented',()=>{for(const alignment of ['center','start','end']){const f=fixture([[clip('a','Video',0,3),clip('b','Video',3,6)]]);f.seq.videoTracks[0].transitions=collection([transition(2,4,alignment)]);assert.match(f.queue(),/two-sided|neighbor|双边/);assert.equal(encoded(f).length,0);}});
test('B08 missing XML alignment, ambiguous mapping, or snapshot failure never guesses transition sides',()=>{for(const options of [{xmlTransitionDuplicate:true},{xmlThrows:true},{xmlTransitionChannelConflict:true}]){const f=fixture([[clip('v','Video',0,3)]],[],options);f.seq.videoTracks[0].transitions=collection([transition(2,3,'end-black')]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);}});
test('B08 transition cut point inconsistent with its one-sided label is rejected',()=>{const f=fixture([[clip('v','Video',0,3)]]),tr=transition(2,3,'end-black');tr.xmlCut='0';f.seq.videoTracks[0].transitions=collection([tr]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);});
test('B08 one-sided transition must attach to the target boundary, not merely overlap it',()=>{const f=fixture([[clip('v','Video',0,4)]]);f.seq.videoTracks[0].transitions=collection([transition(1,2,'end-black')]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);});
test('B08 native clone transition boundary mismatch stops submission',()=>{const f=fixture([[clip('v','Video',0,3)]],[],{cloneTransitionMismatch:true});f.seq.videoTracks[0].transitions=collection([transition(2,3,'end-black')]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);});
test('B08 failed transition inspection does not prevent unrelated valid exports',()=>{const f=fixture([[clip('bad','Video',0,3),clip('ok','Video',4,7)]],[],{xmlThrows:true});f.seq.videoTracks[0].transitions=collection([transition(2,3,'end-black')]);assert.match(f.queue('all'),/Queued 1/);assert.equal(encoded(f)[0][1].inValue.ticks,time(4).ticks);});
test('B08 parent adjustment layers are omitted, target and nested internal effects remain opaque',()=>{const g=graphic('g'),adjust=clip('adjust','Video',0,4,{adjustment:true,selected:false}),nest=clip('nest','Video',4,8,{nested:true});nest.internalAdjustment={preserved:true};const f=fixture([[g,nest],[adjust]]);assert.match(f.queue('all'),/Queued 2/);for(const call of encoded(f))assert.equal(call[1].videoTracks[1].clips[0].disabled,true);assert.deepEqual(encoded(f)[1][1].videoTracks[0].clips[1].internalAdjustment,{preserved:true});});
test('B08 track matte dependencies fail explicitly rather than silently removing the matte track',()=>{const v=clip('v','Video',0,4,{components:[{matchName:'AE.ADBE Track Matte Key',displayName:'轨道遮罩键'}]}),f=fixture([[v],[graphic('matte',0,4,{selected:false})]]);assert.match(f.queue(),/cross-track|matte|遮罩/i);assert.equal(encoded(f).length,0);});
test('B08 observed video XML omits transition ticks and translates names without changing the native effect',()=>{const f=fixture([[graphic('g',61,63.04)]],[],{xmlTransform:text=>text.replace(/(<transitionitem>)([\s\S]*?)(<\/transitionitem>)/g,(_,a,b,c)=>a+b.replace(/<pproTicks(In|Out)>\d+<\/pproTicks\1>/g,'')+'<effect><name>Cross Dissolve</name></effect>'+c)});f.seq.videoTracks[0].transitions=collection([transition(61,62,'start-black','Pop Motion')]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][1].videoTracks[0].transitions[0].name,'Pop Motion');assert.equal(f.dirs.has('/tmp'),true);assert.equal([...f.files].filter(x=>x.endsWith('.xml')).length,0);});
test('B08 XML disagreement between stereo channels blocks only affected AV',()=>{const v=clip('v','Video',0,3),a=clip('a','Audio',0,3);linked(v,a);const f=fixture([[v]],[[a]],{xmlStereo:true,xmlTransform:text=>{let n=0;return text.replace(/<alignment>end-black<\/alignment>/g,m=>++n===2?'<alignment>center</alignment>':m)}});f.seq.audioTracks[0].transitions=collection([transition(2,3,'end-black')]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);});
test('B08 snapshot track structure must map exactly; unrelated ordinary clips can continue',()=>{const f=fixture([[graphic('g'),clip('ok','Video',5,8)]],[],{xmlTransform:text=>text.replace('</video>','<track></track></video>')});f.seq.videoTracks[0].transitions=collection([transition(0,1,'start-black')]);assert.match(f.queue('all'),/Queued 1/);assert.equal(encoded(f)[0][1].inValue.ticks,time(5).ticks);});
test('B08 exact audio sample ticks do not acquire video frame rounding through transition validation',()=>{const a=clip('a','Audio',0.001,2.001),f=fixture([],[[a]]);f.seq.audioTracks[0].transitions=collection([transition(1.001,2.001,'end-black')]);assert.match(f.queue(),/Queued 1/);assert.equal(encoded(f)[0][1].inValue.ticks,a.start.ticks);assert.equal(encoded(f)[0][1].outValue.ticks,a.end.ticks);assert.equal(f.calls.some(c=>c[0]==='start'),false);});
test('B08 snapshot without exact ticks cannot prove a sample-aligned audio transition using rounded frames',()=>{const a=clip('a','Audio',0.001,2.001),f=fixture([],[[a]],{xmlTransform:text=>text.replace(/(<transitionitem>)([\s\S]*?)(<\/transitionitem>)/g,(_,a,b,c)=>a+b.replace(/<pproTicks(In|Out)>\d+<\/pproTicks\1>/g,'')+c)});f.seq.audioTracks[0].transitions=collection([transition(1.001,2.001,'end-black')]);assert.match(f.queue(),/^ERROR:/);assert.equal(encoded(f).length,0);});
test('B08 ordinary media effect loss is detected before queuing',()=>{const f=fixture([[clip('v','Video',0,3,{components:[{matchName:'AE.ADBE Lumetri',displayName:'Lumetri'}]})]],[],{cloneEffectMismatch:true});assert.match(f.queue(),/render state/);assert.equal(encoded(f).length,0);});
test('B08 same bounds with two native transitions never accept a single XML mapping',()=>{const f=fixture([[clip('v','Video',0,3)]]);f.seq.videoTracks[0].transitions=collection([transition(2,3,'end-black'),transition(2,3,null)]);assert.match(f.queue(),/ambiguous native/);assert.equal(encoded(f).length,0);});
test('B08 graphic and transition preview is read-only and reports separate categories',()=>{const g=graphic('g'),f=fixture([[g]]);f.seq.videoTracks[0].transitions=collection([transition(0,1,'start-black')]);const before=[g.nodeId,g.disabled,g.start.ticks,g.end.ticks,f.seq.inValue.ticks,f.seq.outValue.ticks];const result=f.preview();assert.match(result,/Native graphic jobs: 1/);assert.match(result,/Single-sided transitions retained: 1/);assert.doesNotMatch(result,/SEQUENCE graphic/);assert.deepEqual([g.nodeId,g.disabled,g.start.ticks,g.end.ticks,f.seq.inValue.ticks,f.seq.outValue.ticks],before);assert.equal(f.project.sequences.length,1);assert.equal(f.calls.length,0);});
