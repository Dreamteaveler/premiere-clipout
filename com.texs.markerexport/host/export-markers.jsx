var MarkerExportHostVersion = "1.1.10";
var MarkerExportHostBuild = "B08";
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
    try { if (e && e.__MarkerExportFormatted) return e.__MarkerExportFormatted; } catch (ignoredCached) {}
    var details = [], trace = null;
    try { trace = $.global.__MarkerExportTrace; } catch (ignored) {}
    if (trace) details.push("id=" + trace.id + " stage=" + trace.stage + " call=" + trace.method + " argTypes=" + trace.types);
    var fields = ["name", "message", "line", "fileName", "number"];
    for (var i = 0; i < fields.length; i++) { try { details.push(fields[i] + "=" + String(e[fields[i]])); } catch (ignoredField) {} }
    var message = "Host operation failed";
    try { message = String(e.message || e).replace(/^(?:ERROR:\s*)+/, ""); } catch (ignoredMessage) {}
    var formatted = message + (details.length ? "\n" + details.join(" ") : "");
    try { if (e && typeof e === "object") e.__MarkerExportFormatted = formatted; } catch (ignoredCapture) {}
    return formatted;
}
// CEP / ExtendScript host. Only queue entry points launch AME.
// Official native declarations: Adobe-CEP/Samples/PProPanel/jsx/PremierePro.23.0.d.ts.
var MarkerExport = (function () {
    var AUDIO_EXTENSIONS = /^(wav|wave|aif|aiff|mp3|aac|m4a|flac|ogg)$/i;
    function fail(message) { if (message && typeof message === "object") throw message; throw new Error(message); }
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
    function sourceBaseName(source, kind) {
        if (kind && kind !== "media") {
            var sequenceName = source.name;
            if (typeof sequenceName !== "string" || !sequenceName.replace(/\s/g, "")) fail("Cannot read source sequence name for output naming.");
            return sequenceName;
        }
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
    function sourceIdentity(item, location) {
        var source, node, version = "unavailable";
        try { version = String(app.version || "unavailable"); } catch (ignoredVersion) {}
        function blocked(reason, nodeType) {
            fail("Cannot identify a clip's source project item. location=" + location + " reason=" + reason +
                " sourceType=" + (source === null ? "null" : typeof source) + " nodeIdType=" + nodeType + " hostVersion=" + version +
                "; Source identity is required; no name/path matching.");
        }
        markerTrace("source", "TrackItem.projectItem", [item], "location=" + location);
        try { source = item.projectItem; } catch (sourceError) { blocked("source-getter-threw", "unread"); }
        if (source === null) {
            // Observed PR26 timeline graphics have no ProjectItem. Identify the
            // native graphic explicitly; missing/throwing source getters are not graphics.
            if (location.charAt(0) === "V" && item.type === 1 && item.mediaType === "Video" &&
                typeof item.isMGT === "function" && readFlag(item, "isMGT", "native graphic classification"))
                return { source: null, id: "native-graphic", kind: "graphic" };
            markerTrace("source", "TrackItem.projectItem", [item], "location=" + location + " native graphic classification not confirmed");
            blocked("source-null", "unread");
        }
        if (source === undefined) blocked("source-undefined", "unread");
        if (typeof source !== "object" && typeof source !== "function") blocked("source-invalid-type", "unread");
        markerTrace("source", "ProjectItem.nodeId", [source], "location=" + location);
        try { node = source.nodeId; } catch (identityError) { blocked("node-id-getter-threw", "unread"); }
        // Preserve an actual identifier of zero; reject missing/non-scalar identifiers rather than coercing guesses.
        var validString = typeof node === "string" && /\S/.test(node);
        var validNumber = typeof node === "number" && isFinite(node) && node >= 0 && node <= 9007199254740991 && node === Math.floor(node);
        if (!validString && !validNumber) blocked("node-id-unavailable", typeof node);
        return { source: source, id: String(node) };
    }
    function scan(seq, needIdentity) {
        var records = [], identities = {}, groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < groups.length; g++) {
            var tracks = groups[g], trackCount = count(tracks, "numTracks", "sequence tracks");
            for (var t = 0; t < trackCount; t++) {
                var track = tracks[t], clips = track.clips, clipCount = count(clips, "numItems", "track clips");
                for (var c = 0; c < clipCount; c++) {
                    var item = clips[c], record = { item: item, id: "", kind: g === 0 ? "video" : "audio", track: track,
                        trackIndex: t, clipIndex: c, key: g + ":" + t + ":" + c,
                        location: (g === 0 ? "V" : "A") + (t + 1) + "." + (c + 1), name: "unreadable clip" };
                    records.push(record);
                    try {
                        record.name = String(item.name || "clip");
                        record.id = String(item.nodeId === undefined || item.nodeId === null ? "" : item.nodeId);
                        if (!record.id) fail("Clip identity is missing; cannot resolve actual links.");
                        if (identities["$" + record.id]) {
                            identities["$" + record.id].error = "Clip identity is duplicated; cannot resolve actual links.";
                            fail("Clip identity is duplicated; cannot resolve actual links.");
                        }
                        identities["$" + record.id] = record;
                        var sourceInfo = sourceIdentity(item, record.location);
                        record.source = sourceInfo.source; record.sourceId = sourceInfo.id; record.sourceKind = sourceInfo.kind;
                        record.start = ticks(item.start); record.end = ticks(item.end);
                        record.sourceIn = ticks(item.inPoint); record.sourceOut = ticks(item.outPoint);
                        if (compare(record.end, record.start) <= 0) fail("Clip has an empty or reversed timeline range.");
                    } catch (clipError) { markerError(clipError); record.error = clipError; }
                }
            }
        }
        return { records: records, identities: identities, sequence: seq };
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
    function sourceKind(source) {
        var nested = readFlag(source, "isSequence", "nested sequence classification");
        var multicam = typeof source.isMulticamClip === "function" ? readFlag(source, "isMulticamClip", "multicam source classification") : false;
        return multicam ? "multicam" : (nested ? "nested" : "media");
    }
    function sequenceRenderState(record) {
        // Audit what the public API exposes. Native cloning keeps the actual
        // component values, keyframes and camera selections; never rebuild them.
        var item = record.item, kind = record.source === null ? "graphic" : sourceKind(record.source);
        if (typeof item.getSpeed !== "function") fail("Cannot inspect sequence clip speed. location=" + record.location);
        var speed = nativeCall("state", "TrackItem.getSpeed", [], function () { return item.getSpeed(); });
        if (typeof speed !== "number" || !isFinite(speed) || speed < 0) fail("Cannot inspect sequence clip speed. location=" + record.location);
        var reversed = readFlag(item, "isSpeedReversed", "sequence clip reverse speed"), parts = [kind, String(speed), String(reversed)];
        var components = item.components, n = count(components, "numItems", "sequence clip effect components");
        for (var i = 0; i < n; i++) {
            var component = components[i], match = component && component.matchName, display = component && component.displayName;
            if (typeof match !== "string" && typeof display !== "string") fail("Cannot inspect sequence clip effect identity. location=" + record.location);
            match = typeof match === "string" ? match : ""; display = typeof display === "string" ? display : "";
            parts.push(match.length + ":" + match + display.length + ":" + display);
        }
        return parts.join("|");
    }
    function disabledValue(item, location) {
        markerTrace("state", "TrackItem.disabled.read", [item], "location=" + location);
        var value = item.disabled;
        markerTrace("state", "TrackItem.disabled.value", [value], "location=" + location + " value=" + diagnosticValue(value));
        if (value === false || value === 0) return false;
        if (value === true || value === 1) return true;
        if (value === undefined) return null;
        fail("Cannot inspect clip enabled state. location=" + location + " disabled=" + diagnosticValue(value));
    }
    function xmlScalar(node, field) {
        var values = node.child(field);
        return values.length() === 1 ? String(values[0]).replace(/^\s+|\s+$/g, "") : null;
    }
    function transitionRecords(track) {
        var result = [], items = track.transitions, n = count(items, "numItems", "track transitions");
        for (var i = 0; i < n; i++) {
            var item = items[i], start = ticks(item.start), end = ticks(item.end);
            if (compare(end, start) <= 0) fail("Cannot inspect transition boundaries.");
            var name = String(item.name || ""), match = String(item.matchName || "");
            result.push({start:start, end:end, signature:start + ":" + end + ":" + name.length + ":" + name + match.length + ":" + match});
        }
        return result;
    }
    function transitionTrackSignature(records) {
        var parts = []; for (var i = 0; i < records.length; i++) parts.push(records[i].signature);
        return parts.join("|");
    }
    function transitionSnapshot(seq, inventory) {
        if (inventory.transitionXML) return inventory.transitionXML;
        if (inventory.transitionXMLError) fail(inventory.transitionXMLError);
        var temp = null, file = null, opened = false, created = false;
        try {
            if (typeof seq.exportAsFinalCutProXML !== "function" || typeof XML === "undefined") fail("Sequence XML snapshot API unavailable.");
            temp = folderOf(Folder.temp.fsName + "/MarkerExport-transitions-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000000));
            if (temp.exists || !temp.create()) fail("Cannot reserve transition snapshot directory.");
            created = true;
            file = fileOf(temp.fsName + "/transitions.xml"); file.encoding = "UTF8";
            var ok = nativeCall("transition", "Sequence.exportAsFinalCutProXML", [file.fsName, 1], function () { return seq.exportAsFinalCutProXML(file.fsName, 1); });
            if (!ok || !file.exists || !file.open("r")) fail("Cannot read transition snapshot.");
            opened = true; var xml = new XML(file.read()); file.close(); opened = false;
            var sequences = xml.child("sequence");
            if (String(xml.name()) !== "xmeml" || sequences.length() !== 1) fail("Transition snapshot must contain one parent sequence.");
            var media = sequences[0].child("media"); if (media.length() !== 1) fail("Transition snapshot media missing.");
            var mapped = {}, kinds = ["video", "audio"], groups = [seq.videoTracks, seq.audioTracks];
            for (var g = 0; g < kinds.length; g++) {
                var containers = media[0].child(kinds[g]);
                mapped[kinds[g]] = containers.length() === 1 ? snapshotTrackGroups(containers[0].child("track"), count(groups[g], "numTracks", "sequence tracks")) : [];
            }
            inventory.transitionXML = mapped; return mapped;
        } catch (e) {
            inventory.transitionXMLError = "Cannot prove transition sides from sequence snapshot: " + String(e.message || e);
            fail(inventory.transitionXMLError);
        } finally {
            if (opened) try { file.close(); } catch (closeError) {}
            if (created) try { var files = temp.getFiles(); for (var f = 0; f < files.length; f++) if (files[f] instanceof File) files[f].remove(); temp.remove(); } catch (cleanupError) {}
        }
    }
    function transitionXMLMatches(node, tr, unit) {
        var a = xmlScalar(node, "pproTicksIn"), b = xmlScalar(node, "pproTicksOut");
        if (a !== null || b !== null) return a === tr.start && b === tr.end;
        var start = gridPosition(tr.start, unit), end = gridPosition(tr.end, unit);
        return start && end && !start.remainder && !end.remainder && xmlScalar(node, "start") === start.index && xmlScalar(node, "end") === end.index;
    }
    function oneSidedAlignment(seq, inventory, member, tr, nativeTransitions) {
        var mapped = transitionSnapshot(seq, inventory), channels = mapped[member.kind][member.trackIndex];
        if (!channels || !channels.length) fail("Cannot prove transition sides: parent track mapping unavailable.");
        var nativeMatches = 0;
        for (var i = 0; i < nativeTransitions.length; i++) if (nativeTransitions[i].start === tr.start && nativeTransitions[i].end === tr.end) nativeMatches++;
        if (nativeMatches !== 1) fail("Cannot prove transition sides: ambiguous native boundaries.");
        var side = null;
        for (var c = 0; c < channels.length; c++) {
            var nodes = channels[c].child("transitionitem"), matches = [];
            for (var n = 0; n < nodes.length(); n++) if (transitionXMLMatches(nodes[n], tr, seq.timebase)) matches.push(nodes[n]);
            if (matches.length !== 1) fail("Cannot prove transition sides: ambiguous or missing XML transition mapping.");
            var alignment = xmlScalar(matches[0], "alignment"), cut = xmlScalar(matches[0], "cutPointTicks");
            if (alignment !== "start-black" && alignment !== "end-black") fail("A two-sided or unclassified transition requires neighboring clip context; this job is skipped. location=" + member.location + " alignment=" + alignment);
            if (side !== null && side !== alignment) fail("Cannot prove transition sides: conflicting audio channel alignment.");
            var expectedCut = alignment === "start-black" ? "0" : tickDelta(tr.end, tr.start).replace(/^\+/, "");
            if (cut !== expectedCut) fail("Cannot prove transition sides: cut point does not match the one-sided alignment.");
            side = alignment;
        }
        return side;
    }
    function validateTransitions(seq, inventory, members, start, end) {
        var proofs = [], seen = {};
        if (!inventory.transitionTracks) inventory.transitionTracks = {};
        for (var j = 0; j < members.length; j++) {
            var member = members[j], key = "$" + member.kind + ":" + member.trackIndex;
            if (seen[key]) continue; seen[key] = true;
            var transitions = transitionRecords(member.track);
            inventory.transitionTracks[key] = {kind:member.kind, trackIndex:member.trackIndex, signature:transitionTrackSignature(transitions)};
            for (var k = 0; k < transitions.length; k++) {
                var tr = transitions[k];
                if (compare(tr.start, end) >= 0 || compare(tr.end, start) <= 0) continue;
                var side = oneSidedAlignment(seq, inventory, member, tr, transitions), owners = [];
                for (var i = 0; i < inventory.records.length; i++) {
                    var candidate = inventory.records[i];
                    if (candidate.error || candidate.kind !== member.kind || candidate.trackIndex !== member.trackIndex) continue;
                    if ((side === "start-black" ? candidate.start === tr.start : candidate.end === tr.end) && compare(tr.start, candidate.start) >= 0 && compare(tr.end, candidate.end) <= 0) owners.push(candidate);
                }
                if (owners.length !== 1) fail("Cannot prove unique target ownership of the one-sided transition.");
                var retained = false;
                for (i = 0; i < members.length; i++) if (members[i].key === owners[0].key) retained = true;
                if (!retained) fail("A transition overlaps the requested range but belongs to an unrelated clip; target-only isolation cannot prove its context.");
                proofs.push({kind:member.kind, trackIndex:member.trackIndex, signature:tr.signature, start:tr.start, end:tr.end, side:side, owner:owners[0].location});
            }
        }
        return proofs;
    }
    function verifyRetainedTransitions(copy, job) {
        for (var i = 0; job.transitions && i < job.transitions.length; i++) {
            var proof = job.transitions[i], tracks = proof.kind === "video" ? copy.videoTracks : copy.audioTracks;
            var transitions = transitionRecords(tracks[proof.trackIndex]), matches = 0;
            for (var k = 0; k < transitions.length; k++) if (transitions[k].signature === proof.signature) matches++;
            if (matches !== 1) fail("Clone does not preserve the native transition and its exact boundaries. location=" + proof.owner);
        }
    }
    function snapshotTrackGroups(tracks, expectedCount) {
        var groups = [], index = 0;
        while (index < tracks.length()) {
            var first = tracks[index], current = String(first.attribute("currentExplodedTrackIndex")), total = String(first.attribute("totalExplodedTrackCount")), channels = [];
            var n = total ? Number(total) : 1;
            if (!isFinite(n) || n < 1 || n > 64 || Math.floor(n) !== n || (current && current !== "0")) return [];
            for (var c = 0; c < n; c++) {
                if (index + c >= tracks.length()) return [];
                var channel = tracks[index + c];
                if (total && (String(channel.attribute("currentExplodedTrackIndex")) !== String(c) || String(channel.attribute("totalExplodedTrackCount")) !== total)) return [];
                channels.push(channel);
            }
            groups.push(channels); index += n;
        }
        return groups.length === expectedCount ? groups : [];
    }
    function serializedFrameMatches(raw, value, unit) {
        if (raw === null || !/^\d+$/.test(raw)) return false;
        var grid = gridPosition(value, unit), normalized = raw.replace(/^0+(?=\d)/, "");
        // XML stores integral frames; this check is only for reading enabled state.
        // Actual export still uses the exact original ticks and its existing boundary validation.
        return normalized === grid.index || (grid.remainder !== 0 && normalized === incrementInteger(grid.index));
    }
    function snapshotSourceUnit(node) {
        var rates = node.child("rate"); if (rates.length() !== 1) return null;
        var rateText = xmlScalar(rates[0], "timebase"), ntsc = xmlScalar(rates[0], "ntsc");
        if (!rateText || !/^\d+$/.test(rateText) || (ntsc !== "TRUE" && ntsc !== "FALSE")) return null;
        var rate = Number(rateText), unit = 254016000000 * (ntsc === "TRUE" ? 1001 : 1) / (rate * (ntsc === "TRUE" ? 1000 : 1));
        return rate > 0 && rate <= 1000 && isFinite(unit) && unit > 0 && Math.floor(unit) === unit ? String(unit) : null;
    }
    function snapshotAnchor(record, node, timelineUnit) {
        if (!serializedFrameMatches(xmlScalar(node, "start"), record.start, timelineUnit) || !serializedFrameMatches(xmlScalar(node, "end"), record.end, timelineUnit)) return null;
        var inside = xmlScalar(node, "pproTicksIn"), outside = xmlScalar(node, "pproTicksOut"), sourceMethod = "";
        if (inside !== null || outside !== null) {
            if (inside === null || outside === null || !/^\d+$/.test(inside) || !/^\d+$/.test(outside) ||
                inside.replace(/^0+(?=\d)/, "") !== record.sourceIn || outside.replace(/^0+(?=\d)/, "") !== record.sourceOut) return null;
            sourceMethod = "exact-source-ticks";
        } else {
            var sourceUnit = snapshotSourceUnit(node);
            if (!sourceUnit || !serializedFrameMatches(xmlScalar(node, "in"), record.sourceIn, sourceUnit) || !serializedFrameMatches(xmlScalar(node, "out"), record.sourceOut, sourceUnit)) return null;
            sourceMethod = "declared-source-frames";
        }
        var start = gridPosition(record.start, timelineUnit), end = gridPosition(record.end, timelineUnit);
        return sourceMethod + ((start.remainder || end.remainder) ? "+serialized-timeline-frames" : "+exact-timeline-frames");
    }
    function snapshotReverseCount(node, inventory, kind, trackIndex, unit) {
        var n = 0;
        for (var i = 0; i < inventory.records.length; i++) {
            var record = inventory.records[i];
            if (record.kind === kind && record.trackIndex === trackIndex && !record.error && snapshotAnchor(record, node, unit)) n++;
        }
        return n;
    }
    function snapshotNativeDetail(record, unit) {
        var start = gridPosition(record.start, unit), end = gridPosition(record.end, unit);
        return "nativeTimeline=" + record.start + ".." + record.end + " nativeSource=" + record.sourceIn + ".." + record.sourceOut +
            " nativeFrames=" + start.index + "+" + start.remainder + "/" + start.unit + ".." + end.index + "+" + end.remainder + "/" + end.unit;
    }
    function snapshotNodeDetail(node) {
        return "xmlStart=" + xmlScalar(node, "start") + " xmlEnd=" + xmlScalar(node, "end") + " xmlTicksIn=" + xmlScalar(node, "pproTicksIn") + " xmlTicksOut=" + xmlScalar(node, "pproTicksOut") +
            " xmlIn=" + xmlScalar(node, "in") + " xmlOut=" + xmlScalar(node, "out") + " xmlSourceUnit=" + snapshotSourceUnit(node) + " xmlEnabled=" + xmlScalar(node, "enabled");
    }
    function legacyEnabledSnapshot(seq, inventory) {
        if (typeof seq.exportAsFinalCutProXML !== "function" || typeof XML === "undefined") fail("Cannot inspect clip enabled state: TrackItem.disabled is unavailable and sequence XML snapshot API is unavailable.");
        var temp = folderOf(Folder.temp.fsName + "/MarkerExport-state-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000000));
        if (temp.exists || !temp.create()) fail("Cannot create an isolated sequence-state snapshot directory.");
        var snapshot = fileOf(temp.fsName + "/state.xml"), opened = false; snapshot.encoding = "UTF8";
        try {
            var acknowledged = nativeCall("state", "Sequence.exportAsFinalCutProXML", [snapshot.fsName, 1], function () { return seq.exportAsFinalCutProXML(snapshot.fsName, 1); });
            if (!acknowledged || !snapshot.exists) fail("Cannot inspect clip enabled state: sequence XML snapshot failed.");
            if (!snapshot.open("r")) fail("Cannot read sequence XML snapshot.");
            opened = true; var text = snapshot.read(); snapshot.close(); opened = false;
            var xml = new XML(text), sequences = xml.child("sequence");
            if (String(xml.name()) !== "xmeml" || sequences.length() !== 1) fail("Cannot inspect clip enabled state: snapshot does not contain exactly one sequence.");
            var media = sequences[0].child("media"); if (media.length() !== 1) fail("Cannot inspect clip enabled state: snapshot media is unavailable.");
            var groups = [seq.videoTracks, seq.audioTracks];
            inventory.snapshotCounts = {exactSourceTicks:0, declaredSourceFrames:0, serializedTimeline:0, unknown:0};
            inventory.snapshotTracks = [];
            for (var g = 0; g < groups.length; g++) {
                var kind = g === 0 ? "video" : "audio", containers = media[0].child(kind);
                if (containers.length() !== 1) continue;
                var tracks = containers[0].child("track"), grouped = snapshotTrackGroups(tracks, count(groups[g], "numTracks", "sequence tracks"));
                markerTrace("state", "Snapshot.trackMap", [tracks.length(), grouped.length], "kind=" + kind + " nativeTracks=" + groups[g].numTracks);
                inventory.snapshotTracks.push(kind + ": native=" + groups[g].numTracks + " xml=" + tracks.length() + " groups=" + grouped.length);
                for (var di = 0; di < inventory.records.length; di++) {
                    var unmapped = inventory.records[di];
                    if (unmapped.kind === kind && !unmapped.error && unmapped.disabled === null) unmapped.stateDiagnostic = "reason=" + (grouped.length ? "no-candidate" : "track-structure-mismatch") + " " + snapshotNativeDetail(unmapped, seq.timebase);
                }
                for (var t = 0; t < grouped.length; t++) {
                    var used = {};
                    for (var i = 0; i < inventory.records.length; i++) {
                        var record = inventory.records[i];
                        if (record.kind !== kind || record.trackIndex !== t || record.error || record.disabled !== null) continue;
                        var state = null, valid = true, mapped = [], proofs = [];
                        for (var channelIndex = 0; channelIndex < grouped[t].length; channelIndex++) {
                            var exported = grouped[t][channelIndex].child("clipitem"), matches = [], candidates = [];
                            for (var c = 0; c < exported.length(); c++) {
                                var node = exported[c], proof = snapshotAnchor(record, node, seq.timebase);
                                if (serializedFrameMatches(xmlScalar(node, "start"), record.start, seq.timebase) && candidates.length < 2) candidates.push(snapshotNodeDetail(node));
                                if (proof) matches.push({index:c, proof:proof});
                            }
                            if (!matches.length && channelIndex > 0 && !exported.length()) continue;
                            if (matches.length !== 1 || used["$" + channelIndex + ":" + matches[0].index]) {
                                valid = false; record.stateDiagnostic = "reason=" + (matches.length > 1 ? "ambiguous-xml-candidates" : candidates.length ? "source-anchor-mismatch" : "timeline-anchor-mismatch") +
                                    " channel=" + channelIndex + " matches=" + matches.length + " " + snapshotNativeDetail(record, seq.timebase) + " " + candidates.join(" | "); break;
                            }
                            var matchedNode = exported[matches[0].index];
                            if (snapshotReverseCount(matchedNode, inventory, kind, t, seq.timebase) !== 1) {
                                valid = false; record.stateDiagnostic = "reason=ambiguous-native-candidates " + snapshotNativeDetail(record, seq.timebase) + " " + snapshotNodeDetail(matchedNode); break;
                            }
                            var value = xmlScalar(matchedNode, "enabled");
                            if ((value !== "TRUE" && value !== "FALSE") || (state !== null && state !== value)) {
                                valid = false; record.stateDiagnostic = "reason=invalid-or-conflicting-enabled " + snapshotNodeDetail(matchedNode); break;
                            }
                            state = value; mapped.push("$" + channelIndex + ":" + matches[0].index); proofs.push(matches[0].proof);
                        }
                        if (!valid || state === null) continue;
                        for (var mapIndex = 0; mapIndex < mapped.length; mapIndex++) used[mapped[mapIndex]] = true;
                        record.disabled = state === "FALSE"; record.stateProof = proofs.join(",");
                        if (/exact-source-ticks/.test(record.stateProof)) inventory.snapshotCounts.exactSourceTicks++; else inventory.snapshotCounts.declaredSourceFrames++;
                        if (/serialized-timeline-frames/.test(record.stateProof)) inventory.snapshotCounts.serializedTimeline++;
                        markerTrace("state", "Snapshot.clipitem.enabled", [state], "location=" + record.location + " disabled=" + record.disabled + " proof=" + record.stateProof);
                    }
                }
            }
            for (var ui = 0; ui < inventory.records.length; ui++) if (!inventory.records[ui].error && inventory.records[ui].disabled === null) inventory.snapshotCounts.unknown++;
            inventory.snapshotSummary = "SNAPSHOT exactSourceTicks=" + inventory.snapshotCounts.exactSourceTicks + " declaredSourceFrames=" + inventory.snapshotCounts.declaredSourceFrames +
                " serializedTimeline=" + inventory.snapshotCounts.serializedTimeline + " unknown=" + inventory.snapshotCounts.unknown + " | " + inventory.snapshotTracks.join("; ");
        } finally {
            if (opened) try { snapshot.close(); } catch (closeError) {}
            // Delete only files in the fresh task-owned directory (including Adobe's translation report).
            try { var files = temp.getFiles(); for (var f = 0; f < files.length; f++) if (files[f] instanceof File) files[f].remove(); temp.remove(); } catch (cleanupError) {}
        }
    }
    function inspectEnabledStates(seq, inventory) {
        var missing = false;
        for (var i = 0; i < inventory.records.length; i++) {
            var record = inventory.records[i];
            if (record.error) continue;
            try { record.disabled = disabledValue(record.item, record.location); if (record.disabled === null) missing = true; }
            catch (stateError) { markerError(stateError); record.error = stateError; }
        }
        inventory.legacyIsolation = missing;
        if (missing) legacyEnabledSnapshot(seq, inventory);
    }
    function verifyOriginalInventory(seq, inventory) {
        var current = scan(seq, false);
        if (current.records.length !== inventory.records.length) fail("Original sequence clip inventory changed; batch stopped.");
        for (var i = 0; i < current.records.length; i++) {
            var old = inventory.records[i], now = current.records[i];
            if (old.key !== now.key || old.item.nodeId !== now.item.nodeId || (!old.error && (now.error || old.sourceId !== now.sourceId || old.start !== now.start || old.end !== now.end || old.sourceIn !== now.sourceIn || old.sourceOut !== now.sourceOut)))
                fail("Original sequence clip state changed; batch stopped. location=" + old.location);
            if (old.disabled !== undefined && !inventory.legacyIsolation && !old.error && disabledValue(now.item, old.location) !== old.disabled) fail("Original sequence enabled state changed; batch stopped.");
            if (old.sequenceState && sequenceRenderState(now) !== old.sequenceState) fail("Original sequence clip render state changed; batch stopped. location=" + old.location);
        }
        for (var key in (inventory.transitionTracks || {})) if (inventory.transitionTracks.hasOwnProperty(key)) {
            var state = inventory.transitionTracks[key], tracks = state.kind === "video" ? seq.videoTracks : seq.audioTracks;
            if (transitionTrackSignature(transitionRecords(tracks[state.trackIndex])) !== state.signature) fail("Original transition state changed; batch stopped.");
        }
    }
    function validateMember(member, seq) {
        if (member.error) fail(member.error);
        markerTrace("state", "Validated.clip.enabled", [member.disabled], "location=" + member.location);
        if (member.disabled === null || member.disabled === undefined) fail("Cannot inspect clip enabled state. location=" + member.location + " disabled=undefined; snapshot has no exact unambiguous state mapping. " + (member.stateDiagnostic || "reason=snapshot-state-unavailable"));
        if (member.disabled) fail("A requested linked clip is disabled; enable it or change the selection. location=" + member.location);
        if (readMute(member.track)) fail("A requested track is muted; enable it before exporting.");
        if (member.error) fail(member.error);
        var source = member.source;
        member.sourceKind = source === null ? "graphic" : sourceKind(source);
        member.sequenceState = sequenceRenderState(member);
        var effects = member.item.components;
        for (var effectIndex = 0; effectIndex < count(effects, "numItems", "clip effect components"); effectIndex++) {
            var effectId = String(effects[effectIndex].matchName || "");
            if (/track[ ._-]*matte|set[ ._-]*matte/i.test(effectId))
                fail("Cross-track matte dependency is not supported by target-only isolation; matte context must be preserved explicitly. location=" + member.location + " effect=" + effectId);
        }
        if (source && typeof source.isOffline === "function") {
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
        var inventory = scan(seq, true), jobs = [], visited = {}, selectedCount = 0, skipped = [];
        inspectEnabledStates(seq, inventory);
        for (var i = 0; i < inventory.records.length; i++) {
            var record = inventory.records[i];
            var group = null;
            if (visited["$" + record.key]) continue;
            try {
            if (scope === "selected") {
                if (typeof record.item.isSelected !== "function") fail("Cannot read timeline selection.");
                if (!record.item.isSelected()) continue;
            }
            selectedCount++;
            if (!record.id) fail(record.error || "Clip identity unavailable.");
            group = linkedSet(record, inventory);
            if (record.error) fail(record.error);
            var videos = [], audios = [];
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
                (member.kind === "video" ? videos : audios).push(member); visited["$" + member.key] = true;
            }
            if (videos.length > 1) fail("Multiple video clips in one link group are not supported; unlink or export separately.");
            if (!videos.length && audios.length > 1) fail("Audio-only link groups require an explicit grouping decision; unlink to export each separately.");
            if (videos.length) {
                var timebase = Number(seq.timebase);
                if (!timebase || timebase !== Math.floor(timebase) || timebase > 900719925474099) fail("Cannot determine the sequence video frame boundary.");
                if (remainder(start, timebase) || remainder(end, timebase)) fail("Video/AV group boundaries are not aligned to sequence frames; no rounding will be applied.");
            }
            var transitionProofs = validateTransitions(seq, inventory, group.members, start, end);
            var main = videos.length ? videos[0] : audios[0];
            var setterAudioUnit = audioUnit(seq);
            var boundaryUnit = videos.length ? String(seq.timebase) : setterAudioUnit;
            jobs.push({ kind: videos.length ? "video" : "audio", members: group.members, boundaryUnit: boundaryUnit, setterAudioUnit: videos.length ? setterAudioUnit : null,
                startFrame: videos.length ? gridPosition(start, boundaryUnit).index : null, endFrame: videos.length ? gridPosition(end, boundaryUnit).index : null,
                start: start, end: end, startSeconds: startSeconds, endSeconds: endSeconds,
                name: main.sourceKind === "graphic" ? main.name : sourceBaseName(main.source, main.sourceKind), sourceKind: main.sourceKind, transitions: transitionProofs, order: jobs.length });
            } catch (itemError) {
                var affected = group ? group.members : [record];
                for (var si = 0; si < affected.length; si++) visited["$" + affected[si].key] = true;
                skipped.push({ location: locations(affected), reason: markerError(itemError) });
            }
        }
        if (!selectedCount && !skipped.length) fail(scope === "selected" ? "Select timeline clips first; nothing was queued." : "No enabled timeline clips found.");
        jobs.sort(function (a, b) { return compare(a.start, b.start) || a.order - b.order; });
        return { jobs: jobs, inventory: inventory, skipped: skipped, scope: scope };
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
    function locations(members) {
        var values = []; for (var i = 0; i < members.length; i++) values.push(members[i].location + " clip=" + members[i].name);
        return values.join(" + ");
    }
    function notices(values, label) {
        var lines = []; for (var i = 0; i < values.length; i++) lines.push(label + " " + values[i].location + ": " + values[i].reason);
        return lines.join("\n");
    }
    function emptyPlan(plan) {
        var skipped = plan.skipped || [];
        return "ERROR: " + (skipped.length ? skipped[0].reason : "No valid export jobs.") + "\nQueued 0 of 0 jobs. Skipped " + skipped.length + ". Failed 0.\n" + notices(skipped, "SKIP");
    }
    function describe(plan) {
        var video = 0, audio = 0, lines = [], sequenceLines = [], graphicLines = [], transitionLines = [];
        for (var i = 0; i < plan.jobs.length; i++) {
            var job = plan.jobs[i]; if (job.kind === "audio") audio++; else video++;
            if (job.sourceKind === "graphic") graphicLines.push("GRAPHIC " + locations(job.members) + " | timeline " + job.startSeconds + " -> " + job.endSeconds + " seconds");
            else if (job.sourceKind && job.sourceKind !== "media") sequenceLines.push("SEQUENCE " + job.sourceKind + " " + locations(job.members) + " source=" + job.name + " | timeline " + job.startSeconds + " -> " + job.endSeconds + " seconds");
            for (var ti = 0; job.transitions && ti < job.transitions.length; ti++) transitionLines.push("TRANSITION " + job.transitions[ti].owner + " " + job.transitions[ti].side + " | ticks " + job.transitions[ti].start + " -> " + job.transitions[ti].end);
            if (i < 20) {
                lines.push(pad(i + 1) + " " + job.kind + " " + (job.filename || job.name) + " | timeline " + job.startSeconds + " -> " + job.endSeconds + " seconds" + (job.members ? " | " + locations(job.members) : ""));
                if (job.kind === "video") lines.push("  sequence frames: " + job.startFrame + " -> " + job.endFrame + " (Out exclusive); " + tickDelta(job.endFrame, job.startFrame).replace(/^\+/, "") + " frames; ticks/frame=" + job.boundaryUnit);
                if (job.kind === "audio" && job.boundaryUnit) lines.push("  independent audio sample grid: ticks/sample=" + job.boundaryUnit + "; no video-frame rounding");
                if (job.members) for (var j = 0; j < job.members.length; j++) {
                    var m = job.members[j]; lines.push("  " + m.kind + " source In/Out: " + m.item.inPoint.seconds + " -> " + m.item.outPoint.seconds + " seconds");
                }
            }
        }
        return "Planned " + plan.jobs.length + " jobs: " + video + " video, " + audio + " audio.\nTimeline inventory: " + plan.inventory.records.length + " clips in the active sequence; scope=" + plan.scope + ". Linked AV counts as one task group.\nBuild: " + MarkerExportHostVersion + " " + MarkerExportHostBuild + "; CLIP-NULL-v2 + FRAME-GRID-v1\n" + lines.join("\n") +
            (plan.jobs.length > 20 ? "\n(Only the first 20 jobs are shown.)" : "") +
            "\nTask groups: " + (plan.jobs.length + (plan.skipped || []).length) + "; planned=" + plan.jobs.length + "; skipped=" + (plan.skipped || []).length + "." +
            (graphicLines.length ? "\nNative graphic jobs: " + graphicLines.length + ".\n" + graphicLines.join("\n") : "") +
            (transitionLines.length ? "\nSingle-sided transitions retained: " + transitionLines.length + ".\n" + transitionLines.join("\n") : "") +
            (sequenceLines.length ? "\nSequence-source jobs: " + sequenceLines.length + ".\n" + sequenceLines.join("\n") + "\nOnly the target timeline instance and its actual linked audio are retained in the parent sequence copy. Keep referenced source sequences unchanged until AME finishes." : "") +
            "\n" + (plan.inventory.snapshotSummary || "Native enabled-state API used.") + "\nSkipped " + (plan.skipped || []).length + ".\n" + notices(plan.skipped || [], "SKIP") + "\nLinked AV uses the union of its trimmed timeline ranges; gaps become silence/black.\nQueue only. Export copies stay in the project until you delete them after AME finishes.";
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
        verifyRetainedTransitions(copy, job);
        if (copied.records.length !== inventory.records.length) fail("Clone clip count does not match the original sequence.");
        for (var m = 0; job.members && m < job.members.length; m++) {
            wanted["$" + job.members[m].key] = true;
            wantedTracks["$" + job.members[m].kind + ":" + job.members[m].trackIndex] = true;
        }
        for (var i = 0; i < copied.records.length; i++) {
            var original = inventory.records[i], current = copied.records[i];
            if (original.key !== current.key) fail("Clone does not preserve track positions.");
            if (original.item === current.item || original.track === current.track) fail("Clone shares original timeline objects; isolation would mutate the original.");
            if (original.error || current.error) {
                if (!job.members || wanted["$" + current.key]) fail("Cannot prove the requested cloned source identity and trimmed boundaries.");
                // Retain unreadable slots and verify they are disabled below before allowing any valid export.
            } else if (original.sourceId !== current.sourceId || original.start !== current.start || original.end !== current.end ||
                original.sourceIn !== current.sourceIn || original.sourceOut !== current.sourceOut) fail("Clone does not preserve track positions and trimmed source boundaries.");
            if (wanted["$" + current.key] && original.sequenceState) {
                if (sequenceRenderState(current) !== original.sequenceState) fail("Clone does not preserve sequence clip render state. location=" + original.location);
                current.sequenceState = original.sequenceState;
            }
        }
        var originalGroups = [inventory.sequence.videoTracks, inventory.sequence.audioTracks], cloneGroups = [copy.videoTracks, copy.audioTracks];
        for (var cg = 0; cg < cloneGroups.length; cg++) {
            if (count(originalGroups[cg], "numTracks", "original tracks") !== count(cloneGroups[cg], "numTracks", "clone tracks")) fail("Clone track inventory changed; isolation stopped.");
            for (var ct = 0; ct < originalGroups[cg].numTracks; ct++) if (originalGroups[cg][ct] === cloneGroups[cg][ct]) fail("Clone shares original timeline objects; isolation would mutate the original.");
        }
        for (i = 0; i < copied.records.length; i++) {
            current = copied.records[i];
            if (job.members && !inventory.legacyIsolation) {
                if (disabledValue(current.item, current.location) === null) fail("Cannot inspect cloned clip isolation state.");
                markerTrace("isolate", "TrackItem.disabled", [!wanted["$" + current.key]]);
                current.item.disabled = !wanted["$" + current.key];
                if (disabledValue(current.item, current.location) !== !wanted["$" + current.key]) fail("Clip isolation failed; an unrelated clip could remain enabled.");
            }
        }

        if (job.members && inventory.legacyIsolation) {
            // PR15 has no native disabled property. Remove unrelated items from this clone only, without ripple or frame alignment.
            for (var ri = copied.records.length - 1; ri >= 0; ri--) {
                var unwanted = copied.records[ri];
                if (!wanted["$" + unwanted.key]) {
                    if (typeof unwanted.item.remove !== "function") fail("Clone-only removal API unavailable; cannot prove clip isolation.");
                    nativeCall("isolate", "TrackItem.remove", [false, false], function () { return unwanted.item.remove(false, false); });
                }
            }
            var retained = scan(copy, false), expected = [];
            for (ri = 0; ri < copied.records.length; ri++) if (wanted["$" + copied.records[ri].key]) expected.push(copied.records[ri]);
            if (retained.records.length !== expected.length) fail("Clone-only removal isolation failed; unrelated clips remain or linked members were removed.");
            for (ri = 0; ri < expected.length; ri++) {
                var before = expected[ri], after = retained.records[ri];
                if (after.error || before.kind !== after.kind || before.trackIndex !== after.trackIndex || before.id !== after.id || before.sourceId !== after.sourceId || before.start !== after.start || before.end !== after.end || before.sourceIn !== after.sourceIn || before.sourceOut !== after.sourceOut)
                    fail("Clone-only removal isolation changed retained clip identity or trimmed boundaries.");
                if (before.sequenceState && sequenceRenderState(after) !== before.sequenceState) fail("Clone-only removal changed sequence clip render state.");
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
        verifyRetainedTransitions(copy, job);
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
        if (inResult.rejected || outResult.rejected) fail("Premiere changed exact export boundaries (frame/sample rounding); this job was not queued.\nBOUNDARY job=" + job.kind + " name=" + job.name + " sequenceID=" + copy.sequenceID + "\nexpectedInTicks=" + job.start + " actualInTicks=" + inResult.actual + "\nexpectedOutTicks=" + job.end + " actualOutTicks=" + outResult.actual + "\ntimebase=" + String(copy.timebase) + " inputInSeconds=" + String(job.startSeconds) + " inputOutSeconds=" + String(job.endSeconds));
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
    function submissionLedger() {
        if (typeof $ === "undefined" || !$.global) fail("Session submission ledger is unavailable; duplicate prevention cannot be guaranteed.");
        if (!$.global.__MarkerExportSubmissionsB04) $.global.__MarkerExportSubmissionsB04 = {};
        return $.global.__MarkerExportSubmissionsB04;
    }
    function submissionKey(seq, job, folderPath) {
        var parts = [String(app.project.documentID || app.project.path || ""), String(seq.sequenceID), String(folderOf(folderPath).fsName).toLowerCase(), job.kind, job.start, job.end, String(job.preset.path).toLowerCase()];
        for (var i = 0; job.members && i < job.members.length; i++) {
            var m = job.members[i]; parts.push(m.id, m.sourceId, m.start, m.end, m.sourceIn, m.sourceOut);
        }
        // Length prefixes prevent delimiter collisions in names, identities and paths.
        var result = "$"; for (i = 0; i < parts.length; i++) { var v = String(parts[i]); result += v.length + ":" + v; }
        return result;
    }
    function queue(seq, plan, folderPath, videoPreset, audioPreset) {
        if (!plan.jobs.length) return emptyPlan(plan);
        if (typeof seq.clone !== "function" || typeof app.project.openSequence !== "function") fail("Sequence cloning/restoration API is unavailable.");
        if (!folderPath || !folderOf(folderPath).exists) fail("Export folder not found.");
        var oldIn = seq.getInPointAsTime(), oldOut = seq.getOutPointAsTime();
        var prepared = [], copies = 0, queued = 0, folder = null, error = "", failures = [], skipped = (plan.skipped || []).slice(0), ledger = submissionLedger();
        try {
            preparePresets(seq, plan, videoPreset, audioPreset);
            var i, job;
            for (i = 0; i < plan.jobs.length; i++) {
                job = plan.jobs[i]; job.location = job.members ? locations(job.members) : "marker " + (i + 1) + " name=" + job.name;
                job.submissionKey = submissionKey(seq, job, folderPath);
                if (ledger[job.submissionKey]) {
                    skipped.push({location: job.location, reason: "already submitted or acknowledgement uncertain; not submitted again. " + ledger[job.submissionKey]}); continue;
                }
                try {
                    var copy = clone(seq); copies++;
                    copy.name = "__ClipExport_" + pad(i + 1) + "_" + safeName(job.name);
                    isolate(copy, plan.inventory, job);
                    prepared.push({sequence:copy, job:job});
                } catch (preparationError) { skipped.push({location:job.location, reason:markerError(preparationError)}); }
                // Restoration is a global safety requirement even after an individual failure.
                restore(seq, oldIn, oldOut);
                verifyOriginalInventory(seq, plan.inventory);
            }
            if (prepared.length) {
                folder = batchFolder(folderPath); assignOutputNames(plan, folder);
                nativeCall("encode", "Encoder.launchEncoder", [], function () { return app.encoder.launchEncoder(); });
                for (i = 0; i < prepared.length; i++) {
                    var preparedJob = prepared[i]; job = preparedJob.job;
                    var output = folder.fsName + "/" + job.filename;
                    try {
                        if (fileOf(output).exists) fail("Output already exists; refusing to overwrite: " + output);
                        // Record before the native call: a thrown call may already have submitted the job.
                        ledger[job.submissionKey] = "acknowledgement uncertain; output=" + output;
                        var id = nativeCall("encode", "Encoder.encodeSequence", [preparedJob.sequence, output, job.preset.path, 1, 0, false], function () { return app.encoder.encodeSequence(preparedJob.sequence, output, job.preset.path, 1, 0, false); });
                        if (!id || String(id) === "0") { delete ledger[job.submissionKey]; fail("AME rejected export job " + (i + 1) + "."); }
                        ledger[job.submissionKey] = "accepted jobID=" + id + " output=" + output; queued++;
                    } catch (submissionError) { failures.push({location:job.location, reason:markerError(submissionError)}); }
                }
            }
        } catch (e) { error = markerError(e); }
        finally { try { restore(seq, oldIn, oldOut); verifyOriginalInventory(seq, plan.inventory); } catch (restoreError) { error += (error ? "\n" : "") + markerError(restoreError); } }
        var state = "Queued " + queued + " of " + plan.jobs.length + " jobs. Skipped " + skipped.length + ". Failed " + failures.length + ".";
        var detail = state + "\n" + (plan.inventory.snapshotSummary || "Native enabled-state API used.") + "\n" + notices(skipped, "SKIP") + "\n" + notices(failures, "FAIL") + (folder ? "\nOutput folder: " + folder.fsName : "") +
            "\n" + copies + " __ClipExport_ sequence copies remain. Keep them until AME finishes, then delete them manually. Original In/Out points preserved." +
            "\nQueue NOT started. Accepted job IDs confirm submission only; final AME encoding results are not observed.";
        if (error || failures.length || (!queued && skipped.length)) return "ERROR: " + (error || (failures.length ? failures[0].reason : skipped[0].reason)) + "\n" + detail;
        return "Queued " + queued + " export(s) in Adobe Media Encoder. Queue NOT started.\n" + detail;
    }
    function run(mode, folder, video, audio, scope) {
        try { var seq = active(); return queue(seq, mode === "markers" ? makeMarkerJobs(seq) : makeClipJobs(seq, scope), folder, video, audio); }
        catch (e) { return "ERROR: " + (markerError(e)); }
    }
    return {
        preview: function (scope, videoPreset, audioPreset) {
            var seq;
            try { seq = active(); var plan = makeClipJobs(seq, scope); if (!plan.jobs.length) { var empty = emptyPlan(plan); if (/Cannot inspect clip link collection/.test(empty)) empty += "\n" + linkDiagnostics(seq); return empty; } if (videoPreset || audioPreset) preparePresets(seq, plan, videoPreset, audioPreset); return describe(plan); }
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
