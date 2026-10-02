var MarkerExportHostVersion = "1.1.4";
function markerTrace(stage, method, args, detail) {
    try {
        if (typeof $ === "undefined" || !$.global || !$.global.__MarkerExportTrace) return;
        var trace = $.global.__MarkerExportTrace, types = [];
        for (var i = 0; args && i < args.length; i++) types.push(typeof args[i]);
        trace.stage = stage; trace.method = method; trace.types = types.join(",");
        trace.lines.push("[" + trace.id + "] stage=" + stage + " call=" + method + " argTypes=" + trace.types + (detail ? " " + detail : ""));
        if (trace.lines.length > 160) trace.lines.splice(4, 1);
    } catch (ignored) {}
}
function nativeCall(stage, method, args, invoke) { markerTrace(stage, method, args); return invoke(); }
function fileOf(path) { return nativeCall("path", "File", [path], function () { return new File(path); }); }
function folderOf(path) { return nativeCall("path", "Folder", [path], function () { return new Folder(path); }); }
function markerError(e) {
    var details = [], trace = null;
    try { trace = $.global.__MarkerExportTrace; } catch (ignored) {}
    if (trace) details.push("id=" + trace.id + " stage=" + trace.stage + " call=" + trace.method + " argTypes=" + trace.types);
    var fields = ["name", "message", "line", "fileName", "number"];
    for (var i = 0; i < fields.length; i++) { try { details.push(fields[i] + "=" + String(e[fields[i]])); } catch (ignoredField) {} }
    var message = "Host operation failed";
    try { message = String(e.message || e).replace(/^(?:ERROR:\s*)+/, ""); } catch (ignoredMessage) {}
    return message + (details.length ? "\n" + details.join(" ") : "");
}
// CEP / ExtendScript host. Only queue entry points launch AME.
// Official native declarations: Adobe-CEP/Samples/PProPanel/jsx/PremierePro.23.0.d.ts.
var MarkerExport = (function () {
    var AUDIO_EXTENSIONS = /^(wav|wave|aif|aiff|mp3|aac|m4a|flac|ogg)$/i;
    function fail(message) { throw new Error(message); }
    function count(value, property, label) {
        markerTrace("collection", "Collection." + property, [value]);
        if (!value) fail("Cannot inspect " + label + ".");
        var n = value[property];
        if (typeof n !== "number" && typeof value.length === "number") n = value.length;
        if (typeof n !== "number" || n < 0 || n !== Math.floor(n)) fail("Cannot inspect " + label + ".");
        return n;
    }
    function ticks(value) {
        markerTrace("time", "Time.ticks", [value]);
        var s = value && String(value.ticks);
        if (!s || !/^\d+$/.test(s)) fail("Cannot read exact timeline/source boundary ticks.");
        return s.replace(/^0+(?=\d)/, "");
    }
    function compare(a, b) {
        if (a.length !== b.length) return a.length < b.length ? -1 : 1;
        return a === b ? 0 : (a < b ? -1 : 1);
    }
    function remainder(s, divisor) {
        var r = 0;
        for (var i = 0; i < s.length; i++) r = (r * 10 + Number(s.charAt(i))) % divisor;
        return r;
    }
    function gridPosition(s, unit) {
        var divisor = Number(unit), quotient = "", r = 0;
        if (!divisor || divisor !== Math.floor(divisor) || divisor > 900719925474099) return null;
        for (var i = 0; i < s.length; i++) {
            r = r * 10 + Number(s.charAt(i));
            quotient += String(Math.floor(r / divisor)); r %= divisor;
        }
        return { index: quotient.replace(/^0+(?=\d)/, ""), remainder: r, unit: divisor };
    }
    function incrementInteger(s) {
        var out = "", carry = 1;
        for (var i = s.length - 1; i >= 0; i--) { var n = Number(s.charAt(i)) + carry; out = String(n % 10) + out; carry = n > 9 ? 1 : 0; }
        return (carry ? "1" : "") + out;
    }
    function tickDelta(actual, expected) {
        if (actual === expected) return "0";
        var positive = compare(actual, expected) > 0, a = positive ? actual : expected, b = positive ? expected : actual, out = "", borrow = 0;
        for (var i = a.length - 1, j = b.length - 1; i >= 0; i--, j--) {
            var digit = Number(a.charAt(i)) - (j >= 0 ? Number(b.charAt(j)) : 0) - borrow;
            if (digit < 0) { digit += 10; borrow = 1; } else borrow = 0;
            out = String(digit) + out;
        }
        return (positive ? "+" : "-") + out.replace(/^0+(?=\d)/, "");
    }
    function audioUnit(seq) {
        try { var rate = seq.getSettings().audioSampleRate; return rate && typeof rate.ticks === "string" ? ticks(rate) : null; }
        catch (e) { return null; }
    }
    function safeName(value) {
        var name = String(value || "clip").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_")
            .replace(/\s+/g, " ").replace(/^\s+|[\s.]+$/g, "");
        return name.substr(0, 80) || "clip";
    }
    function pad(n) { var s = String(n); while (s.length < 3) s = "0" + s; return s; }
    function sourceBaseName(source) {
        if (typeof source.getMediaPath !== "function") fail("Cannot read source media path for output naming.");
        var media = nativeCall("source", "ProjectItem.getMediaPath", [], function () { return source.getMediaPath(); });
        if (typeof media !== "string" || !media) fail("Source has no media file path; output naming cannot use a renamed timeline clip.");
        var leaf = fileOf(media).fsName.split(/[\/\\]/).pop();
        return leaf.replace(/\.[^.]+$/, "") || "clip";
    }
    function assignOutputNames(plan, folder) {
        var used = {}, disk = {}, entries = folder && typeof folder.getFiles === "function" ? folder.getFiles() : [];
        for (var e = 0; e < entries.length; e++) disk["$" + entries[e].fsName.split(/[\/\\]/).pop().toLowerCase()] = true;
        for (var i = 0; i < plan.jobs.length; i++) {
            var job = plan.jobs[i], base = safeName(job.name);
            if (job.kind === "marker") base = pad(i + 1) + "_" + base;
            if (/^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(base)) base = "_" + base;
            var n = 1, candidate, key;
            do {
                var suffix = n === 1 ? "" : "_" + (n < 10 ? "0" : "") + n;
                candidate = base + suffix + "." + job.preset.extension;
                key = "$" + candidate.toLowerCase(); n++;
            } while (used[key] || disk[key] || (folder && fileOf(folder.fsName + "/" + candidate).exists));
            used[key] = true; job.filename = candidate;
        }
    }
    function preparePresets(seq, plan, videoPreset, audioPreset) {
        var cache = {};
        for (var i = 0; i < plan.jobs.length; i++) {
            var job = plan.jobs[i], key = job.kind;
            if (!cache[key]) cache[key] = preset(seq, key === "audio" ? audioPreset : videoPreset, key === "audio", key === "video");
            job.preset = cache[key];
        }
        assignOutputNames(plan, null);
    }
    function active() {
        markerTrace("activeSeq", "Project.activeSequence", []);
        var seq = app.project.activeSequence;
        if (!seq) fail("No active sequence open.");
        return seq;
    }
    function scan(seq, needIdentity) {
        var records = [], identities = {}, groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < groups.length; g++) {
            var tracks = groups[g], trackCount = count(tracks, "numTracks", "sequence tracks");
            for (var t = 0; t < trackCount; t++) {
                var track = tracks[t], clips = track.clips, clipCount = count(clips, "numItems", "track clips");
                for (var c = 0; c < clipCount; c++) {
                    var item = clips[c], id = String(item.nodeId || ""), source = item.projectItem;
                    if (needIdentity && (!id || identities["$" + id])) fail("Clip identity is missing or duplicated; cannot resolve actual links.");
                    if (!source || !source.nodeId) fail("Cannot identify a clip's source project item.");
                    var record = { item: item, id: id, kind: g === 0 ? "video" : "audio", track: track,
                        trackIndex: t, clipIndex: c, key: g + ":" + t + ":" + c,
                        sourceId: String(source.nodeId), start: ticks(item.start), end: ticks(item.end),
                        sourceIn: ticks(item.inPoint), sourceOut: ticks(item.outPoint), name: String(item.name || "clip") };
                    if (compare(record.end, record.start) <= 0) fail("Clip has an empty or reversed timeline range.");
                    records.push(record); identities["$" + id] = record;
                }
            }
        }
        return { records: records, identities: identities };
    }
    function linkedSet(record, inventory) {
        if (typeof record.item.getLinkedItems !== "function") fail("Official clip link API is unavailable; links will not be guessed.");
        var linked = nativeCall("collection", "TrackItem.getLinkedItems", [], function () { return record.item.getLinkedItems(); });
        // Observed in Premiere 26.0.0: unlinked clips return null; linked
        // TrackItemCollections contain the queried clip as well as its links.
        if (linked !== null && typeof linked !== "object") fail("Cannot inspect clip link collection.");
        var n = linked === null ? 0 : count(linked, "numItems", "clip link collection");
        var result = {}, members = [record]; result["$" + record.id] = true;
        for (var i = 0; i < n; i++) {
            var id = linked[i] && String(linked[i].nodeId || ""), target = inventory.identities["$" + id];
            if (!id || !target) fail("Linked clip identity cannot be resolved in this sequence.");
            if (!result["$" + id]) { result["$" + id] = true; members.push(target); }
        }
        return { ids: result, members: members };
    }
    function diagnosticValue(value) {
        if (value === null) return "object:null";
        var type = typeof value;
        if (type === "string" || type === "number" || type === "boolean" || type === "undefined")
            return type + ":" + String(value).replace(/[\r\n\t]/g, " ").substr(0, 80);
        return type;
    }
    function diagnosticProperty(value, name) {
        try { return name + "=" + diagnosticValue(value[name]); }
        catch (e) { return name + "=<unreadable>"; }
    }
    function linkShape(value) {
        var shape = "type=" + diagnosticValue(value);
        if (value === null || (typeof value !== "object" && typeof value !== "function")) return shape;
        try { shape += " class=" + Object.prototype.toString.call(value); } catch (e) {}
        try { if (value.reflect && value.reflect.name) shape += " reflect=" + String(value.reflect.name).substr(0, 80); } catch (e) {}
        var properties = ["numItems", "length", "numTracks", "numLinkedItems", "nodeId"];
        for (var p = 0; p < properties.length; p++) shape += " " + diagnosticProperty(value, properties[p]);
        var ids = [];
        for (var i = 0; i < 4; i++) {
            try {
                var item = value[i];
                if (item === null || typeof item === "undefined") break;
                ids.push(item.nodeId ? String(item.nodeId).substr(0, 80) : "<missing-nodeId>");
            } catch (e) { ids.push("<unreadable>"); break; }
        }
        return shape + " indexedIds=" + (ids.length ? ids.join(",") : "<none>");
    }
    function linkDiagnostics(seq) {
        var lines = ["LINK-DIAG-v1 host=" + diagnosticValue(app.version)];
        try {
            var inventory = scan(seq, true), records = inventory.records;
            for (var i = 0; i < records.length && i < 16; i++) {
                var record = records[i], label = (record.kind === "video" ? "V" : "A") +
                    (record.trackIndex + 1) + "." + (record.clipIndex + 1);
                try {
                    var value = record.item.getLinkedItems();
                    lines.push(label + " id=" + record.id + " " + linkShape(value));
                } catch (e) { lines.push(label + " getLinkedItems threw: " + String(e.message || e).substr(0, 160)); }
            }
            if (records.length > 16) lines.push("Only the first 16 clips are shown.");
        } catch (e) { lines.push("Diagnostic scan failed: " + String(e.message || e).substr(0, 160)); }
        return lines.join("\n");
    }
    function readFlag(owner, method, label) {
        if (typeof owner[method] !== "function") fail("Cannot inspect " + label + ".");
        var value = nativeCall("state", method, [], function () { return owner[method](); });
        if (value !== true && value !== false && value !== 0 && value !== 1) fail("Cannot inspect " + label + ": unsupported host response.");
        return value === true || value === 1;
    }
    function readMute(track) { return readFlag(track, "isMuted", "the track mute state"); }
    function validateMember(member, seq) {
        if (member.item.disabled !== false && member.item.disabled !== 0) fail("A requested linked clip is disabled; enable it or change the selection.");
        if (readMute(member.track)) fail("A requested track is muted; enable it before exporting.");
        var source = member.item.projectItem;
        if (readFlag(source, "isSequence", "nested sequence classification")) fail("Nested/multicam sequence clips are not supported by isolated clip export.");
        if (typeof source.isOffline === "function") {
            var offline = nativeCall("source", "ProjectItem.isOffline", [], function () { return source.isOffline(); }), label = "sequence=" + seq.name + " sequenceID=" + seq.sequenceID + " " + (member.kind === "video" ? "V" : "A") + (member.trackIndex + 1) + "." + (member.clipIndex + 1) + " clip=" + member.name + " sourceId=" + member.sourceId;
            try { label += " media=" + source.getMediaPath(); } catch (pathError) {}
            if (offline === true || offline === 1) fail("A requested source is offline. " + label + " isOffline=" + diagnosticValue(offline));
            if (offline !== false && offline !== 0) fail("Cannot inspect source offline state. " + label + " isOffline=" + diagnosticValue(offline));
        }
        if (member.kind === "video" && readFlag(member.item, "isAdjustmentLayer", "video adjustment layer classification")) fail("Adjustment layers are not independent source clips.");
    }
    function makeClipJobs(seq, scope) {
        if (scope !== "selected" && scope !== "all") fail("Choose selected clips or all timeline clips.");
        if (seq.captionTracks && count(seq.captionTracks, "numTracks", "caption tracks") > 0) fail("Caption tracks are not supported by isolated clip export.");
        var inventory = scan(seq, true), jobs = [], visited = {}, selectedCount = 0;
        for (var i = 0; i < inventory.records.length; i++) {
            var record = inventory.records[i];
            if (scope === "selected") {
                if (typeof record.item.isSelected !== "function") fail("Cannot read timeline selection.");
                if (!record.item.isSelected()) continue;
            } else if (record.item.disabled === true || record.item.disabled === 1) continue;
            selectedCount++;
            if (visited["$" + record.id]) continue;
            var group = linkedSet(record, inventory), videos = [], audios = [];
            var start = record.start, end = record.end, startSeconds = record.item.start.seconds, endSeconds = record.item.end.seconds;
            for (var j = 0; j < group.members.length; j++) {
                var member = group.members[j]; validateMember(member, seq);
                var reciprocal = linkedSet(member, inventory);
                if (reciprocal.members.length !== group.members.length) fail("Clip links are inconsistent; refusing to infer an AV group.");
                for (var k = 0; k < group.members.length; k++) {
                    if (!reciprocal.ids["$" + group.members[k].id]) fail("Clip links are not reciprocal; refusing to infer an AV group.");
                }
                if (compare(member.start, start) < 0) { start = member.start; startSeconds = member.item.start.seconds; }
                if (compare(member.end, end) > 0) { end = member.end; endSeconds = member.item.end.seconds; }
                (member.kind === "video" ? videos : audios).push(member); visited["$" + member.id] = true;
            }
            if (videos.length > 1) fail("Multiple video clips in one link group are not supported; unlink or export separately.");
            if (!videos.length && audios.length > 1) fail("Audio-only link groups require an explicit grouping decision; unlink to export each separately.");
            if (videos.length) {
                var timebase = Number(seq.timebase);
                if (!timebase || timebase !== Math.floor(timebase) || timebase > 900719925474099) fail("Cannot determine the sequence video frame boundary.");
                if (remainder(start, timebase) || remainder(end, timebase)) fail("Video/AV group boundaries are not aligned to sequence frames; no rounding will be applied.");
            }
            for (j = 0; j < group.members.length; j++) {
                var transitions = group.members[j].track.transitions;
                var transitionCount = count(transitions, "numItems", "track transitions");
                for (k = 0; k < transitionCount; k++) {
                    if (compare(ticks(transitions[k].start), end) < 0 && compare(ticks(transitions[k].end), start) > 0) fail("A transition overlaps the requested range; isolated export cannot include neighboring material.");
                }
            }
            var main = videos.length ? videos[0] : audios[0];
            var setterAudioUnit = audioUnit(seq);
            var boundaryUnit = videos.length ? String(seq.timebase) : setterAudioUnit;
            jobs.push({ kind: videos.length ? "video" : "audio", members: group.members, boundaryUnit: boundaryUnit, setterAudioUnit: videos.length ? setterAudioUnit : null,
                startFrame: videos.length ? gridPosition(start, boundaryUnit).index : null, endFrame: videos.length ? gridPosition(end, boundaryUnit).index : null,
                start: start, end: end, startSeconds: startSeconds, endSeconds: endSeconds,
                name: sourceBaseName(main.item.projectItem), order: jobs.length });
        }
        if (!selectedCount || !jobs.length) fail(scope === "selected" ? "Select timeline clips first; nothing was queued." : "No enabled timeline clips found.");
        jobs.sort(function (a, b) { return compare(a.start, b.start) || a.order - b.order; });
        return { jobs: jobs, inventory: inventory };
    }
    function makeMarkerJobs(seq) {
        var markers = seq.markers;
        if (!markers || !markers.numMarkers) fail("No sequence markers found.");
        var list = [], marker = markers.getFirstMarker(), jobs = [];
        while (marker) { list.push(marker); marker = markers.getNextMarker(marker); }
        for (var i = 0; i < list.length; i++) {
            var m = list[i], endTime = compare(ticks(m.end), ticks(m.start)) > 0 ? m.end : (i + 1 < list.length ? list[i + 1].start : null);
            if (!endTime || compare(ticks(endTime), ticks(m.start)) <= 0) continue;
            jobs.push({ kind: "marker", start: ticks(m.start), end: ticks(endTime), startSeconds: m.start.seconds,
                endSeconds: endTime.seconds, name: m.name || m.comments || "marker" });
        }
        if (!jobs.length) fail("No valid marker ranges found.");
        return { jobs: jobs, inventory: scan(seq, false) };
    }
    function describe(plan) {
        var video = 0, audio = 0, lines = [];
        for (var i = 0; i < plan.jobs.length; i++) {
            var job = plan.jobs[i]; if (job.kind === "audio") audio++; else video++;
            if (i < 20) {
                lines.push(pad(i + 1) + " " + job.kind + " " + (job.filename || job.name) + " | timeline " + job.startSeconds + " -> " + job.endSeconds + " seconds");
                if (job.kind === "video") lines.push("  sequence frames: " + job.startFrame + " -> " + job.endFrame + " (Out exclusive); " + tickDelta(job.endFrame, job.startFrame).replace(/^\+/, "") + " frames; ticks/frame=" + job.boundaryUnit);
                if (job.kind === "audio" && job.boundaryUnit) lines.push("  independent audio sample grid: ticks/sample=" + job.boundaryUnit + "; no video-frame rounding");
                if (job.members) for (var j = 0; j < job.members.length; j++) {
                    var m = job.members[j]; lines.push("  " + m.kind + " source In/Out: " + m.item.inPoint.seconds + " -> " + m.item.outPoint.seconds + " seconds");
                }
            }
        }
        return "Planned " + plan.jobs.length + " jobs: " + video + " video, " + audio + " audio.\nBuild: CLIP-NULL-v2 + FRAME-GRID-v1\n" + lines.join("\n") +
            (plan.jobs.length > 20 ? "\n(Only the first 20 jobs are shown.)" : "") +
            "\nLinked AV uses the union of its trimmed timeline ranges; gaps become silence/black.\nQueue only. Export copies stay in the project until you delete them after AME finishes.";
    }
    function preset(seq, path, audioOnly, videoOnly) {
        var label = audioOnly ? "Audio" : "Video/export", file = path ? fileOf(path) : null;
        if (!file || !file.exists) fail(label + " preset file not found; choose a .epr preset. Path: " + String(path));
        var nativePath = file.fsName, raw = nativeCall("preset", "Sequence.getExportFileExtension", [nativePath], function () { return seq.getExportFileExtension(nativePath); });
        var ext = String(raw || "").replace(/^\./, "").toLowerCase();
        if (!/^[a-z0-9]+$/.test(ext)) fail(label + " preset has no valid export file extension; no fallback format will be guessed.\nPreset path: " + nativePath + "\nAPI getExportFileExtension returned " + (typeof raw) + ": " + String(raw));
        if (audioOnly && !AUDIO_EXTENSIONS.test(ext)) fail("Audio-only preset must export an audio container (for example WAV), not " + ext + ".");
        if (videoOnly && AUDIO_EXTENSIONS.test(ext)) fail("Video preset must include video, not an audio-only container.");
        return { path: nativePath, extension: ext };
    }
    function sequenceIds() {
        var values = {}, sequences = app.project.sequences;
        for (var i = 0, n = count(sequences, "numSequences", "project sequences"); i < n; i++) values["$" + sequences[i].sequenceID] = true;
        return values;
    }
    function clone(seq) {
        var before = sequenceIds(); nativeCall("clone", "Sequence.clone", [], function () { return seq.clone(); });
        var sequences = app.project.sequences, found = [];
        for (var i = 0, n = count(sequences, "numSequences", "project sequences"); i < n; i++) {
            if (!before["$" + sequences[i].sequenceID]) found.push(sequences[i]);
        }
        if (found.length !== 1 || found[0].sequenceID === seq.sequenceID) fail("Cannot identify exactly one newly cloned sequence.");
        return found[0];
    }
    function setGridBoundary(copy, expected, isOut, unit, videoSampleUnit) {
        var seconds = Number(expected) / 254016000000;
        if (!isFinite(seconds) || seconds < 0) fail("Cannot represent the requested boundary in Premiere's seconds API.");
        var limit = Math.max(1, Math.ceil(Math.abs(seconds) * 2.220446049250313e-16 * 254016000000 * 2));
        var desired = unit ? gridPosition(expected, unit) : null, actual, delta;
        for (var attempt = 0; attempt < 3; attempt++) {
            if (isOut) nativeCall("boundary", "Sequence.setOutPoint", [seconds], function () { return copy.setOutPoint(seconds); }); else nativeCall("boundary", "Sequence.setInPoint", [seconds], function () { return copy.setInPoint(seconds); });
            actual = ticks(nativeCall("time", isOut ? "Sequence.getOutPointAsTime" : "Sequence.getInPointAsTime", [], function () { return isOut ? copy.getOutPointAsTime() : copy.getInPointAsTime(); }));
            if (actual === expected) return { actual: actual, delta: "0", exact: true };
            delta = tickDelta(actual, expected);
            // Only compensate a measured floating-point conversion error. A frame/sample jump is never retried or accepted.
            if (delta.length > 7 || Math.abs(Number(delta)) > limit) break;
            var step = Math.max(1 / 254016000000, Math.abs(seconds) * 2.220446049250313e-16);
            seconds = Math.max(0, seconds - Number(delta) / 254016000000 + (Number(delta) < 0 ? step : -step));
        }
        var readback = desired ? gridPosition(actual, unit) : null;
        var nearest = readback && (readback.remainder * 2 >= readback.unit ? incrementInteger(readback.index) : readback.index);
        if (desired && desired.remainder === 0 && nearest === desired.index && delta.length <= 7 && Math.abs(Number(delta)) <= limit)
            return { actual: actual, delta: delta, exact: false };
        // PR's seconds setter may floor video boundaries to the sequence audio sample grid.
        // Accept only that exact representable coordinate and the same requested video frame.
        // Independent audio never receives videoSampleUnit and retains its existing sample checks.
        var requestedSamples = videoSampleUnit ? gridPosition(expected, videoSampleUnit) : null;
        var actualSamples = requestedSamples ? gridPosition(actual, videoSampleUnit) : null;
        if (desired && desired.remainder === 0 && nearest === desired.index && requestedSamples && actualSamples &&
            requestedSamples.unit * 2 < desired.unit && requestedSamples.remainder > 0 && actualSamples.remainder === 0 &&
            actualSamples.index === requestedSamples.index) {
            markerTrace("boundary", "AudioSampleFloorSameVideoFrame", [unit, videoSampleUnit], "requestedTicks=" + expected + " actualTicks=" + actual + " deltaTicks=" + delta + " frameIndex=" + desired.index + " ticksPerSample=" + videoSampleUnit);
            return { actual: actual, delta: delta, exact: false, quantization: "audio-sample-floor", frameIndex: desired.index, sampleUnit: String(videoSampleUnit) };
        }
        return { actual: actual, delta: delta, rejected: true };
    }
    function isolate(copy, inventory, job) {
        var copied = scan(copy, false), wanted = {}, wantedTracks = {};
        if (copied.records.length !== inventory.records.length) fail("Clone clip count does not match the original sequence.");
        for (var m = 0; job.members && m < job.members.length; m++) {
            wanted["$" + job.members[m].key] = true;
            wantedTracks["$" + job.members[m].kind + ":" + job.members[m].trackIndex] = true;
        }
        for (var i = 0; i < copied.records.length; i++) {
            var original = inventory.records[i], current = copied.records[i];
            if (original.key !== current.key || original.sourceId !== current.sourceId || original.start !== current.start || original.end !== current.end ||
                original.sourceIn !== current.sourceIn || original.sourceOut !== current.sourceOut) fail("Clone does not preserve track positions and trimmed source boundaries.");
            if (job.members) {
                if (current.item.disabled !== false && current.item.disabled !== true && current.item.disabled !== 0 && current.item.disabled !== 1) fail("Cannot inspect cloned clip isolation state.");
                markerTrace("isolate", "TrackItem.disabled", [!wanted["$" + current.key]]);
                current.item.disabled = !wanted["$" + current.key];
                if (!!current.item.disabled !== !wanted["$" + current.key]) fail("Clip isolation failed; an unrelated clip could remain enabled.");
            }
        }
        if (job.members) {
            var groups = [copy.videoTracks, copy.audioTracks];
            for (var g = 0; g < groups.length; g++) for (var t = 0; t < count(groups[g], "numTracks", "copied tracks"); t++) {
                var track = groups[g][t], mute = !wantedTracks["$" + (g === 0 ? "video" : "audio") + ":" + t];
                if (typeof track.setMute !== "function" || typeof track.isMuted !== "function") fail("Cannot enforce cloned track isolation.");
                nativeCall("isolate", "Track.setMute", [mute ? 1 : 0], function () { return track.setMute(mute ? 1 : 0); });
                if (readMute(track) !== mute) fail("Track isolation failed; an unrelated track could remain audible/visible.");
            }
        }
        var inResult, outResult;
        if (job.kind === "marker") {
            copy.setInPoint(job.startSeconds); copy.setOutPoint(job.endSeconds);
            inResult = { actual: ticks(copy.getInPointAsTime()) }; outResult = { actual: ticks(copy.getOutPointAsTime()) };
            inResult.rejected = inResult.actual !== job.start; outResult.rejected = outResult.actual !== job.end;
        } else {
            if (job.kind === "video" && String(copy.timebase) !== job.boundaryUnit) fail("Cloned sequence has a different video frame grid.");
            var copiedSampleUnit = job.kind === "video" ? audioUnit(copy) : null;
            if (job.kind === "video" && job.setterAudioUnit && copiedSampleUnit !== job.setterAudioUnit) fail("Cloned sequence has a different audio sample grid.");
            var videoSampleUnit = job.kind === "video" && job.setterAudioUnit ? copiedSampleUnit : null;
            inResult = setGridBoundary(copy, job.start, false, job.boundaryUnit, videoSampleUnit); outResult = setGridBoundary(copy, job.end, true, job.boundaryUnit, videoSampleUnit);
        }
        if (inResult.rejected || outResult.rejected) fail("Premiere changed exact export boundaries (frame/sample rounding); no jobs were queued.\nBOUNDARY job=" + job.kind + " name=" + job.name + " sequenceID=" + copy.sequenceID + "\nexpectedInTicks=" + job.start + " actualInTicks=" + inResult.actual + "\nexpectedOutTicks=" + job.end + " actualOutTicks=" + outResult.actual + "\ntimebase=" + String(copy.timebase) + " inputInSeconds=" + String(job.startSeconds) + " inputOutSeconds=" + String(job.endSeconds));
        job.boundaryAudit = "in=" + inResult.actual + " out=" + outResult.actual + " tickDelta=" + (inResult.delta || "0") + "/" + (outResult.delta || "0") + " quantization=" + (inResult.quantization || "exact-or-float") + "/" + (outResult.quantization || "exact-or-float") + " audioSampleTicks=" + (job.setterAudioUnit || "unavailable");
    }
    function batchFolder(path) {
        var parent = folderOf(path);
        if (!parent.exists) fail("Export folder not found.");
        var base = parent.fsName + "/premiere-export-" + new Date().getTime();
        for (var i = 1; i < 10000; i++) {
            var folder = folderOf(base + "-" + pad(i));
            if (!folder.exists) {
                if (!folder.create()) fail("Cannot create a unique export batch folder.");
                return folder;
            }
        }
        fail("Cannot reserve a unique export batch folder.");
    }
    function restore(seq, oldIn, oldOut) {
        if (String(seq.getInPointAsTime().ticks) !== String(oldIn.ticks)) seq.setInPoint(oldIn.seconds);
        if (String(seq.getOutPointAsTime().ticks) !== String(oldOut.ticks)) seq.setOutPoint(oldOut.seconds);
        if (String(seq.getInPointAsTime().ticks) !== String(oldIn.ticks) || String(seq.getOutPointAsTime().ticks) !== String(oldOut.ticks)) fail("Could not restore the original sequence In/Out points; review it before continuing.");
        if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) {
            if (!app.project.openSequence(seq.sequenceID)) fail("Could not restore the original active sequence.");
        }
        if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) fail("Could not verify restoration of the original active sequence.");
    }
    function queue(seq, plan, folderPath, videoPreset, audioPreset) {
        if (typeof seq.clone !== "function" || typeof app.project.openSequence !== "function") fail("Sequence cloning/restoration API is unavailable.");
        if (!folderPath || !folderOf(folderPath).exists) fail("Export folder not found.");
        var oldIn = seq.getInPointAsTime(), oldOut = seq.getOutPointAsTime();
        var prepared = [], queued = 0, folder = null, error = "";
        try {
            preparePresets(seq, plan, videoPreset, audioPreset);
            var i, job;
            // Validate every copy before launching AME or queueing any job.
            for (i = 0; i < plan.jobs.length; i++) {
                job = plan.jobs[i]; var copy = clone(seq);
                prepared.push({ sequence: copy, job: job });
                copy.name = "__ClipExport_" + pad(i + 1) + "_" + safeName(job.name);
                isolate(copy, plan.inventory, job);
            }
            restore(seq, oldIn, oldOut);
            folder = batchFolder(folderPath);
            assignOutputNames(plan, folder);
            // Host versions differ in launch return values; encodeSequence's job ID
            // is the acknowledgement that a job actually reached AME.
            nativeCall("encode", "Encoder.launchEncoder", [], function () { return app.encoder.launchEncoder(); });
            for (i = 0; i < prepared.length; i++) {
                var preparedJob = prepared[i]; job = preparedJob.job;
                var output = folder.fsName + "/" + job.filename;
                if (fileOf(output).exists) fail("Output already exists; refusing to overwrite: " + output);
                var id = nativeCall("encode", "Encoder.encodeSequence", [preparedJob.sequence, output, job.preset.path, 1, 0, false], function () { return app.encoder.encodeSequence(preparedJob.sequence, output, job.preset.path, 1, 0, false); });
                if (!id || String(id) === "0") fail("AME rejected export job " + (i + 1) + ".");
                queued++;
            }
        } catch (e) { error = markerError(e); }
        finally { try { restore(seq, oldIn, oldOut); } catch (restoreError) { error += (error ? "\n" : "") + (markerError(restoreError)); } }
        var state = "Queued " + queued + " of " + plan.jobs.length + " jobs. " + prepared.length + " export sequence copies remain in this project.";
        if (error) return "ERROR: " + error + "\n" + state + (folder ? "\nOutput folder: " + folder.fsName : "");
        return "Queued " + queued + " export(s) in Adobe Media Encoder. Queue NOT started.\nOutput folder: " + folder.fsName +
            "\n" + prepared.length + " __ClipExport_ sequence copies remain. Keep them until AME finishes, then delete them manually. Original In/Out points preserved.";
    }
    function run(mode, folder, video, audio, scope) {
        try { var seq = active(); return queue(seq, mode === "markers" ? makeMarkerJobs(seq) : makeClipJobs(seq, scope), folder, video, audio); }
        catch (e) { return "ERROR: " + (markerError(e)); }
    }
    return {
        preview: function (scope, videoPreset, audioPreset) {
            var seq;
            try { seq = active(); var plan = makeClipJobs(seq, scope); if (videoPreset || audioPreset) preparePresets(seq, plan, videoPreset, audioPreset); return describe(plan); }
            catch (e) {
                var message = markerError(e);
                if (seq && /Cannot inspect clip link collection/.test(message)) message += "\n" + linkDiagnostics(seq);
                return "ERROR: " + message;
            }
        },
        diagnose: function (scope) {
            try {
                function precise(value) { return typeof value === "number" ? value.toPrecision(17) : String(value); }
                var seq = active(), lines = ["READ-ONLY BOUNDARY DIAGNOSTIC; no copies or queue jobs created.",
                    "activeSequenceName=" + seq.name + " activeSequenceID=" + seq.sequenceID + " scope=" + scope + " timebase=" + seq.timebase,
                    "Only active-sequence clip media is inspected. Other sequences: names and export-copy boundary metadata only."], job = null;
                try {
                    job = makeClipJobs(seq, scope).jobs[0];
                    lines.push("firstJob=" + job.kind + " name=" + job.name + " expectedInTicks=" + job.start + " expectedOutTicks=" + job.end + " inputInSeconds=" + precise(job.startSeconds) + " inputOutSeconds=" + precise(job.endSeconds));
                    if (job.kind === "video") lines.push("firstJobFrames=" + job.startFrame + " -> " + job.endFrame + " OutExclusive=true ticksPerFrame=" + job.boundaryUnit);
                } catch (planError) { lines.push("Export validation blocked (read-only collection continues): " + (planError.message || String(planError))); }
                try {
                    var rate = seq.getSettings().audioSampleRate;
                    lines.push("audioSampleRateType=" + typeof rate + " raw=" + String(rate) + " seconds=" + (rate && rate.seconds !== undefined ? precise(rate.seconds) : "unavailable") + " ticks=" + (rate && rate.ticks !== undefined ? String(rate.ticks) : "unavailable"));
                } catch (rateError) { lines.push("audioSampleRate=unavailable; " + (rateError.message || String(rateError))); }
                var groups = [seq.videoTracks, seq.audioTracks], printed = 0;
                for (var g = 0; g < groups.length; g++) {
                    var tracks = groups[g];
                    for (var t = 0, nt = count(tracks, "numTracks", "active sequence tracks"); t < nt; t++) {
                        var clips = tracks[t].clips;
                        for (var c = 0, nc = count(clips, "numItems", "active sequence clips"); c < nc; c++) {
                            var item = clips[c], label = (g === 0 ? "V" : "A") + (t + 1) + "." + (c + 1);
                            try {
                                var selected = typeof item.isSelected === "function" ? item.isSelected() : "unavailable";
                                if (scope === "selected" && selected !== true && selected !== 1) continue;
                                if (scope === "all" && (item.disabled === true || item.disabled === 1)) continue;
                                if (++printed > 120) continue;
                                var source = item.projectItem, media = "unavailable", offline = "unavailable", nested = "unavailable";
                                try { media = source.getMediaPath(); } catch (mediaError) { media = "unreadable: " + mediaError.message; }
                                try { if (typeof source.isOffline === "function") offline = source.isOffline(); } catch (offlineError) { offline = "threw: " + offlineError.message; }
                                try { if (typeof source.isSequence === "function") nested = source.isSequence(); } catch (nestedError) { nested = "threw: " + nestedError.message; }
                                lines.push(label + " sequence=" + seq.name + " clip=" + item.name + " sourceId=" + (source && source.nodeId) + " media=" + media + " selected=" + diagnosticValue(selected) + " isOffline=" + diagnosticValue(offline) + " isSequence=" + diagnosticValue(nested) + " startTicks=" + ticks(item.start) + " endTicks=" + ticks(item.end) + " startSeconds=" + precise(item.start.seconds) + " endSeconds=" + precise(item.end.seconds));
                            } catch (clipError) { lines.push(label + " read failed; continuing: " + (clipError.message || String(clipError))); }
                        }
                    }
                }
                if (printed > 120) lines.push("Only first 120 in-scope active-sequence clips are shown.");
                var sequences = app.project.sequences, shown = 0, n = count(sequences, "numSequences", "project sequences");
                lines.push("projectSequenceCount=" + n);
                for (var i = 0; i < n; i++) {
                    var copy = sequences[i];
                    if (copy.sequenceID === seq.sequenceID || !/^__ClipExport_/.test(String(copy.name))) continue;
                    if (++shown > 30) continue;
                    try {
                        var actualIn = copy.getInPointAsTime(), actualOut = copy.getOutPointAsTime();
                        lines.push("candidateCopy name=" + copy.name + " sequenceID=" + copy.sequenceID + " timebase=" + copy.timebase + " actualInTicks=" + ticks(actualIn) + " actualOutTicks=" + ticks(actualOut) + " actualInSeconds=" + precise(actualIn.seconds) + " actualOutSeconds=" + precise(actualOut.seconds) + (job ? " deltaInTicks=" + tickDelta(ticks(actualIn), job.start) + " deltaOutTicks=" + tickDelta(ticks(actualOut), job.end) : ""));
                    } catch (copyError) { lines.push("candidateCopy boundary read failed: " + copy.name + " " + copyError.message); }
                }
                if (!shown) lines.push("No export copies found. No re-queue is needed for diagnostics.");
                lines.push("Candidates may belong to earlier runs. No copies deleted or original points changed.");
                return lines.join("\n");
            } catch (e) { return "ERROR: " + (markerError(e)); }
        },
        run: run
    };
})();
function validateOutputFolder(path) {
    if (typeof path !== "string" || /[\x00\r\n]/.test(path) || !/^(?:[A-Za-z]:[\/\\]|\\\\[^\\]+\\[^\\]+)/.test(path)) return "ERROR: 请输入完整 Windows 文件夹路径（盘符或 UNC），不要输入相对路径。";
    var folder = folderOf(path);
    return folder.exists ? "OK\t" + folder.fsName : "ERROR: 文件夹不存在或不可访问。请先在资源管理器中创建你指定的文件夹，再应用路径。";
}
function diagnoseExportBoundaries(scope) { return MarkerExport.diagnose(scope || "selected"); }
function previewClipExports(scope, videoPreset, audioPreset) { return MarkerExport.preview(scope, videoPreset, audioPreset); }
function exportClipsAsFiles(folder, videoPreset, audioPreset, scope) { return MarkerExport.run("clipboundary", folder, videoPreset, audioPreset, scope || "selected"); }
function exportMarkersAsClips(folder, preset) { return MarkerExport.run("markers", folder, preset, null, null); }

function validatePresetPath(path) {
    try {
        if (typeof path !== "string" || /[\x00\r\n]/.test(path) || !/^(?:[A-Za-z]:[\/\\]|\\\\[^\\]+\\[^\\]+)/.test(path)) return "ERROR: 请输入完整的 Windows .epr 文件路径（盘符或 UNC）。";
        if (!/\.epr$/i.test(path)) return "ERROR: 请选择 .epr 预设文件。";
        var file = fileOf(path);
        if (!file.exists) return "ERROR: 预设文件不存在或不可访问。";
        return "OK\t" + String(file.fsName);
    } catch (e) { return "ERROR: 无法验证预设路径：" + (markerError(e)); }
}
