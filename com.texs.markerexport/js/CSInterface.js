var MarkerExportBuild = { version: "1.1.10", build: "B08", hostVersion: "1.1.10", hostBuild: "B08" };
window.MarkerExportBuild = MarkerExportBuild;
/* CEP bridge: native inputs and results are primitive strings. */
function MarkerExportSHA256(bytes) {
    var constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], words = [], length = bytes.length, i, j;
    function rotate(x, n) { return (x >>> n) | (x << (32-n)); }
    for (i=0;i<length;i++) words[i>>>2] = (words[i>>>2] || 0) | (bytes[i] << (24-(i%4)*8));
    words[length>>>2] = (words[length>>>2] || 0) | (0x80 << (24-(length%4)*8));
    var padded = Math.ceil((length+9)/64)*16;
    words[padded-2] = Math.floor(length/536870912); words[padded-1] = (length*8)|0;
    for (i=0;i<padded;i+=16) {
        var w=[],a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];
        for (j=0;j<64;j++) {
            if (j<16) w[j]=words[i+j]||0;
            else { var x=w[j-15],y=w[j-2]; w[j]=(w[j-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[j-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))|0; }
            var t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[j]+w[j])|0;
            var t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
            h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
        }
        var current=[a,b,c,d,e,f,g,h];for(j=0;j<8;j++) hash[j]=(hash[j]+current[j])|0;
    }
    var hex="";for(i=0;i<8;i++) hex+=("00000000"+(hash[i]>>>0).toString(16)).slice(-8);return hex;
}
(function () {
    var rows = [], counter = 0, session = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    window.MarkerExportLog = {
        frontendVersion: MarkerExportBuild.version,
        begin: function (action) { var id = "ME1110-" + MarkerExportBuild.build + "-" + session + "-" + (++counter); this.add(id, "action", action, "", "frontendVersion=" + MarkerExportBuild.version + " build=" + MarkerExportBuild.build + " begin"); return id; },
        add: function (id, stage, method, types, detail) { rows.push("[" + id + "] stage=" + stage + " call=" + method + " argTypes=" + types + (detail ? " " + detail : "")); if (rows.length > 512) rows.shift(); },
        append: function (text) { if (text) { var lines = text.split("\n"); for (var i = 0; i < lines.length; i++) rows.push(lines[i]); while (rows.length > 512) rows.shift(); } },
        text: function () { return "Premiere ClipOut · 剪辑批量导出 · 界面 " + MarkerExportBuild.version + " / host " + MarkerExportBuild.hostVersion + " · " + MarkerExportBuild.build + "\r\n本地日志，不自动上传。\r\n" + rows.join("\r\n"); }
    };
})();
function CSInterface() {}
CSInterface.prototype.getSystemPath = function (type) {
    var root = window.__adobe_cep__.getSystemPath(type);
    if (typeof root !== "string" || !root) throw new Error("Extension path unavailable.");
    root = decodeURI(root);
    return /^file:\/\/\/[A-Za-z]:/.test(root) ? root.replace(/^file:\/\/\//, "") : root.replace(/^file:\/\//, "");
};
CSInterface.prototype.evalScript = function (script, callback) {
    callback = typeof callback === "function" ? callback : function () {};
    var log = window.MarkerExportLog, action = (/^([A-Za-z_$][\w$]*)/.exec(script) || ["", "unknown"])[1], id = log.begin(action);
    function quote(value) { return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
    function hostRequest(hostPath, actionScript, requestId, actionName, expectedVersion, expectedBuild, frontendVersion, bundleBuild) {
        var t = { id: requestId, stage: "hostload", method: "$.evalFile", types: "string", lines: [] };
        function pack(value) { return "__ME_TRACE_V1__\t" + encodeURIComponent(String(value)) + "\t" + encodeURIComponent(t.lines.join("\n")); }
        try {
            $.global.__MarkerExportTrace = t;
            MarkerExportHostVersion = "unreported";
            MarkerExportHostBuild = "unreported";
            t.lines.push("[" + t.id + "] stage=hostload call=$.evalFile argTypes=string");
            $.evalFile(hostPath);
            t.lines.push("[" + t.id + "] stage=hostloaded frontendVersion=" + frontendVersion + " build=" + bundleBuild + " hostVersion=" + (typeof MarkerExportHostVersion === "string" ? MarkerExportHostVersion : "unknown") + " hostBuild=" + MarkerExportHostBuild);
            if (MarkerExportHostVersion !== expectedVersion) throw new Error("Host version mismatch; expected " + expectedVersion + ", got " + MarkerExportHostVersion);
            if (MarkerExportHostBuild !== expectedBuild) throw new Error("Host build mismatch; expected " + expectedBuild + ", got " + MarkerExportHostBuild);
            t.stage = "dispatch"; t.method = actionName; t.types = "serialized primitive arguments";
            t.lines.push("[" + t.id + "] stage=dispatch call=" + t.method + " argTypes=" + t.types);
            var result = eval(actionScript);
            return pack(result === undefined ? "" : result);
        } catch (e) {
            var fields = ["name", "message", "line", "fileName", "number"], details = "id=" + t.id + " stage=" + t.stage + " call=" + t.method + " argTypes=" + t.types;
            for (var i = 0; i < fields.length; i++) { try { details += " " + fields[i] + "=" + String(e[fields[i]]); } catch (ignoredField) {} }
            t.lines.push("[" + t.id + "] " + details);
            var message = String(e.message || e).replace(/^(?:ERROR:\s*)+/, "");
            return pack("ERROR: " + message + "\n" + details);
        } finally { try { delete $.global.__MarkerExportTrace; } catch (ignoredDelete) {} }
    }
    function fileHash(root, relative) {
        try {
            var fs = window.cep && window.cep.fs;
            if (!fs || typeof fs.readFile !== "function") return;
            var value = fs.readFile(root + "/" + relative, "Base64");
            if (!value || value.err !== 0) { log.add(id, "identity", relative, "string", "actualSHA256=unavailable err=" + (value && value.err)); return; }
            var binary = atob(value.data), bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            log.add(id, "identity", relative, "string", "actualSHA256=" + MarkerExportSHA256(bytes));
        } catch (e) { log.add(id, "identity", relative, "string", "actualSHA256=unavailable " + e.message); }
    }
    try {
        log.add(id, "bridgepath", "getSystemPath", "string", "extension");
        var root = this.getSystemPath("extension"), hostPath = root.replace(/[\/\\]+$/, "") + "/host/export-markers.jsx";
        log.add(id, "hostpath", "$.evalFile", "string", "loadedRoot=" + root + " hostPath=" + hostPath);
        fileHash(root, "js/CSInterface.js"); fileHash(root, "js/client.js"); fileHash(root, "host/export-markers.jsx");
        try {
            var fs = window.cep && window.cep.fs;
            if (fs && typeof fs.readFile === "function") {
                var user = this.getSystemPath("userData"), common = this.getSystemPath("commonFiles"), host = this.getSystemPath("hostApplication");
                var candidates = [user + "/Adobe/CEP/extensions/com.texs.markerexport", common + "/Adobe/CEP/extensions/com.texs.markerexport", common.replace(/Program Files \(x86\)/i,"Program Files") + "/Adobe/CEP/extensions/com.texs.markerexport", host + "/CEP/extensions/com.texs.markerexport"], seen = {};
                for (var n=0;n<candidates.length;n++) { var candidate=candidates[n].replace(/\\/g,"/");if(seen[candidate])continue;seen[candidate]=true;var manifest=fs.readFile(candidate+"/CSXS/manifest.xml","UTF8");var version=manifest&&manifest.err===0?(/ExtensionBundleVersion="([^"]+)"/.exec(manifest.data)||[])[1]:"absent or unreadable";log.add(id,"installscan","same extension only","string","path="+candidate+" version="+(version||"unknown")); }
            }
        } catch (scanError) { log.add(id,"installscan","same extension only","string","unavailable "+scanError.message); }
        var wrapped = "(" + hostRequest.toString() + ")(" + [quote(hostPath), quote(script), quote(id), quote(action), quote(MarkerExportBuild.hostVersion), quote(MarkerExportBuild.hostBuild), quote(MarkerExportBuild.version), quote(MarkerExportBuild.build)].join(",") + ")";
        window.__adobe_cep__.evalScript(wrapped, function (raw) {
            var value = typeof raw === "string" ? raw : "ERROR: Native bridge returned " + typeof raw;
            if (value.indexOf("__ME_TRACE_V1__\t") === 0) {
                try { var parts = value.split("\t"); value = decodeURIComponent(parts[1]); log.append(decodeURIComponent(parts[2] || "")); }
                catch (e) { value = "ERROR: Cannot decode host response; id=" + id + " " + e.message; }
            }
            log.add(id, "result", action, "string", /^ERROR:/.test(value) ? value.substr(0, 2000).replace(/[\r\n]/g, " ") : "OK");
            var snapshotSummary = /^SNAPSHOT[^\r\n]*/m.exec(value);
            if (snapshotSummary) log.add(id, "state-summary", action, "string", snapshotSummary[0]);
            callback(value);
        });
    } catch (e) { var text = "ERROR: " + e.message + "\nid=" + id + " stage=bridgepath call=getSystemPath name=" + e.name; log.add(id, "bridgepath", "getSystemPath", "string", text); callback(text); }
};
CSInterface.prototype.getHostEnvironment = function () { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); };
CSInterface.prototype.getApplicationID = function () { return this.getHostEnvironment().appId; };
