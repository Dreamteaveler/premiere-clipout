(function () {
    var cs = new CSInterface(), busy = false;
    if (window.MarkerExportLog && typeof window.MarkerExportLog.add === "function") window.MarkerExportLog.add("SESSION", "frontend", "client.js", "", "executedClientVersion=1.1.9");
    var mode = document.getElementById("mode"), scope = document.getElementById("scope");
    var folderBtn = document.getElementById("folderBtn");
    var previewBtn = document.getElementById("previewBtn");
    var exportBtn = document.getElementById("exportBtn"), status = document.getElementById("status");
    var refreshBtn = document.getElementById("refreshBtn"), bundled = {}, restored = false;
    var folderPath = document.getElementById("folderPath"), folderApplyBtn = document.getElementById("folderApplyBtn"), diagnoseBtn = document.getElementById("diagnoseBtn");
    var logCopyBtn = document.getElementById("logCopyBtn"), logSaveBtn = document.getElementById("logSaveBtn"), logText = document.getElementById("logText");
    var presetSummary = document.getElementById("presetSummary");
    var statusDetails = document.getElementById("statusDetails"), statusFull = document.getElementById("statusFull"), statusDetailLabel = document.getElementById("statusDetailLabel");
    var settings = { folder: null, mode: "clipboundary", scope: "selected" };
    var controls = [mode, scope, folderBtn, previewBtn, exportBtn, refreshBtn, folderPath, folderApplyBtn, diagnoseBtn];
    function setStatus(text, kind) {
        text = text || "";
        var head = text.split(/\r?\n/)[0], count = /Queued (\d+) of (\d+) jobs/.exec(text);
        if (head.length > 110) head = head.substr(0, 107) + "…";
        if (count) head += "（已入队 " + count[1] + "/" + count[2] + "）";
        status.textContent = head; status.className = kind || "";
        status.setAttribute("role", kind === "err" ? "alert" : "status");
        status.setAttribute("aria-live", kind === "err" ? "assertive" : "polite");
        statusFull.textContent = text;
        statusDetails.hidden = !text || text === head;
        statusDetails.open = kind === "err" && !statusDetails.hidden;
        statusDetailLabel.textContent = kind === "err" ? "错误详情" : "查看结果详情";
    }
    function effectivePresets() { return bundled; }
    function name(path) { return path ? path.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() : "尚未选择"; }
    function refreshPresets() {
        if (busy) return;
        bundled = {}; render(); setStatus("正在检测本机 AME 2026 格式…");
        host("(function(){\n    var roots=[], names=[\"4E49434B_48323634/01 - Match Source - High bitrate.epr\",\"3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr\"];\n    function add(p){if(p && roots.join(\"|\").indexOf(p)<0)roots.push(p);}\n    add(Folder.startup.parent.fsName+\"/Adobe Media Encoder 2026\");\n    add($.getenv(\"ProgramW6432\")+\"/Adobe/Adobe Media Encoder 2026\");\n    add($.getenv(\"ProgramFiles\")+\"/Adobe/Adobe Media Encoder 2026\");\n    for(var i=0;i<roots.length;i++){\n        var base=roots[i]+\"/MediaIO/systempresets/\",v=File(base+names[0]),a=File(base+names[1]);\n        if(v.exists && a.exists)return \"OK\\t\"+v.fsName+\"\\t\"+a.fsName;\n    }\n    return \"ERROR: 未找到本机 AME 2026 的 H.264 与 WAV 系统预设。请确认已安装 AME 2026；插件不会猜测或替换编码格式。\";\n})()", function (text) {
            var fields = text.split("\t");
            if (fields.length !== 3 || fields[0] !== "OK" || !fields[1] || !fields[2]) { bundled = {}; render(); setStatus(text.indexOf("ERROR:") === 0 ? text.replace(/^ERROR:/, "错误：") : "无法检测本机格式：Premiere 返回了无效结果。", "err"); return; }
            bundled = { video: fields[1], audio: fields[2] }; render();
            setStatus(settings.folder ? "本机 H.264 与 WAV 格式已就绪。" : "本机格式已就绪，请选择输出文件夹。");
        });
    }
    function quote(value) { return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
    function render() {
        mode.value = settings.mode; scope.value = settings.scope;
        folderPath.value = settings.folder || folderPath.value || "";
        var clipMode = settings.mode === "clipboundary";
        document.getElementById("scopeRow").hidden = !clipMode;
        document.getElementById("hint").textContent = clipMode ?
            "有真实链接的视频与音频合并导出；未链接音频单独导出。每项只包含自己的素材。" :
            "按标记区间导出序列的完整混合画面与声音；末尾点标记作为最后区间的结束。";
        var paths = [["folderVal", settings.folder]];
        paths.forEach(function (entry) { var el = document.getElementById(entry[0]); el.textContent = name(entry[1]); el.title = entry[1] || ""; });
        controls.forEach(function (control) { control.disabled = busy; });
        presetSummary.textContent = "固定：H.264 含音频" + (clipMode ? " · 独立音频 WAV" : "") + (bundled.video ? "（本机格式）" : "（尚未就绪）");
        previewBtn.hidden = !clipMode; previewBtn.disabled = busy || !bundled.video || !bundled.audio;
        var effective = effectivePresets();
        exportBtn.disabled = busy || !settings.folder || !(clipMode ? effective.video && effective.audio : effective.video);
    }
    function save() { try { localStorage.setItem("markerExportSettings", JSON.stringify(settings)); } catch (e) {} }
    function host(call, callback, dialog) {
        busy = true; render();
        var timer = dialog && typeof setTimeout === "function" ? setTimeout(function () { if (busy) setStatus("文件夹对话框尚未返回。请用 Alt+Tab 检查并选择或取消；已禁用重复点击。取消后可粘贴完整路径。", "err"); }, 12000) : null;
        try { cs.evalScript(call, function (result) { if (timer) clearTimeout(timer); busy = false; render(); callback(result || ""); }); }
        catch (e) { if (timer) clearTimeout(timer); busy = false; render(); setStatus("无法连接 Premiere：" + e.message, "err"); }
    }
    function choose(directory, key, label) {
        if (busy) return;
        busy = true; render(); setStatus("正在打开" + label + "选择窗口。请等待；可用 Alt+Tab 查看。", "");
        // CEP12 official NativeFunction.html: bool, bool, string, string, string[], string, string.
        setTimeout(function () {
            try {
                var api = window.cep && window.cep.fs;
                if (!api || typeof api.showOpenDialogEx !== "function") throw new Error("当前面板未提供系统选择接口，请直接粘贴完整路径。");
                var initial = typeof settings[key] === "string" ? settings[key] : "";
                if (!directory && initial) initial = initial.replace(/[\/\\][^\/\\]*$/, "");
                if (!initial) initial = cs.getSystemPath("extension").replace(/[\/\\]+$/, "") + (directory ? "" : "/presets");
                var response = api.showOpenDialogEx(false, directory === true, String(label), String(initial), directory ? ["*"] : ["epr"], directory ? "文件夹" : "Adobe 导出预设", "选择");
                if (!response || typeof response.err !== "number") throw new Error("系统选择窗口没有返回有效结果，请使用路径输入。");
                if (response.err !== 0) throw new Error("系统选择窗口返回错误 " + response.err + "，请使用路径输入。");
                if (!response.data || !response.data.length || response.data[0] === "") { setStatus("已取消，保留原选择。"); return; }
                if (response.data.length !== 1 || typeof response.data[0] !== "string") throw new Error("请选择一个路径。");
                var selected = response.data[0];
                if (!directory && !/\.epr$/i.test(selected)) throw new Error("请选择 .epr 预设文件。");
                settings[key] = selected; save(); setStatus(label + "已设置并记住。", "ok");
            } catch (e) { setStatus("无法打开" + label + "选择窗口：" + (e.message || String(e)), "err"); }
            finally { busy = false; render(); }
        }, 0);
    }
    function result(text) {
        var localized = (text || "Premiere 未返回结果。")
            .replace(/^Planned (\d+) jobs: (\d+) video, (\d+) audio\./, "计划 $1 项任务：$2 个视频，$3 个独立音频。")
            .replace(/Build: /g, "版本：")
            .replace(/sequence frames: /g, "序列帧：")
            .replace(/\(Out exclusive\)/g, "（出点不含）")
            .replace(/ticks\/frame=/g, "每帧 ticks=")
            .replace(/independent audio sample grid: ticks\/sample=/g, "独立音频采样：每样本 ticks=")
            .replace(/; no video-frame rounding/g, "；不按视频帧截断")
            .replace(/ frames; /g, " 帧； ")
            .replace(/^Queued (\d+) export\(s\) in Adobe Media Encoder\. Queue NOT started\./, "已将 $1 项任务加入 AME，尚未开始编码。")
            .replace(/Output folder: /g, "输出目录：")
            .replace(/^ERROR:/, "错误：")
            .replace(/Premiere changed exact export boundaries \(frame\/sample rounding\); no jobs were queued\./g, "Premiere 读回边界未通过帧／样本校验；尚未入队。")
            .replace(/A requested source is offline\./g, "当前序列中请求的源素材被报告为离线：")
            .replace(/Cannot inspect source offline state\./g, "无法确认源素材离线状态：")
            .replace(/Preset has no valid export file extension; no fallback format will be guessed\./g, "预设未返回有效扩展名，请检查所选 .epr；没有自动猜测格式。")
            .replace(/ \| timeline /g, " | 时间线 ")
            .replace(/  video source In\/Out: /g, "  视频源范围：")
            .replace(/  audio source In\/Out: /g, "  音频源范围：");
        setStatus(localized, /^ERROR:|^EvalScript error/i.test(text) || !text ? "err" : "ok");
    }
    try {
        var stored = JSON.parse(localStorage.getItem("markerExportSettings") || "{}");
        restored = !!stored.folder;
        settings.folder = typeof stored.folder === "string" ? stored.folder : null;
        settings.mode = stored.mode === "markers" ? "markers" : "clipboundary";
        settings.scope = stored.scope === "all" ? "all" : "selected";
    } catch (e) {}
    mode.addEventListener("change", function () { settings.mode = mode.value; save(); render(); setStatus(""); });
    scope.addEventListener("change", function () { settings.scope = scope.value; save(); setStatus(""); });
    folderBtn.addEventListener("click", function () { choose(true, "folder", "输出文件夹"); });
    folderApplyBtn.addEventListener("click", function () {
        var path = folderPath.value.replace(/^\s+|\s+$/g, "");
        if (path.charAt(0) === '"' && path.charAt(path.length - 1) === '"') path = path.slice(1, -1);
        if (!path) { setStatus("请粘贴完整输出文件夹路径。", "err"); return; }
        setStatus("正在验证输出位置…");
        host("validateOutputFolder(" + quote(path) + ")", function (text) {
            if (text.indexOf("OK\t") !== 0) { result(text); return; }
            settings.folder = text.substring(3); save(); render(); setStatus("输出路径已验证并记住。", "ok");
        });
    });
    refreshBtn.addEventListener("click", refreshPresets);
    previewBtn.addEventListener("click", function () { setStatus("正在读取剪辑边界、真实链接与计划文件名…"); host("previewClipExports(" + [quote(settings.scope), quote(effectivePresets().video), quote(effectivePresets().audio)].join(",") + ")", result); });
    diagnoseBtn.addEventListener("click", function () { setStatus("只读检查当前序列与已有副本，不入队…"); host("diagnoseExportBoundaries(" + quote(settings.scope) + ")", result); });
    exportBtn.addEventListener("click", function () {
        var effective = effectivePresets(), args = [quote(settings.folder), quote(effective.video)];
        var fn = "exportMarkersAsClips";
        if (settings.mode === "clipboundary") { fn = "exportClipsAsFiles"; args.push(quote(effective.audio), quote(settings.scope)); }
        setStatus("正在准备隔离序列并加入队列…"); host(fn + "(" + args.join(",") + ")", result);
    });
    function showLog() { logText.value = window.MarkerExportLog ? window.MarkerExportLog.text() : "日志组件不可用。"; }
    logCopyBtn.addEventListener("click", function () {
        showLog();
        try { logText.focus(); logText.select(); if (!document.execCommand("copy")) throw new Error("请选中下方日志后按 Ctrl+C。"); setStatus("日志已复制；不会自动上传。", "ok"); }
        catch (e) { setStatus("请选中下方日志后按 Ctrl+C。", "err"); }
    });
    logSaveBtn.addEventListener("click", function () {
        showLog();
        if (!settings.folder) { setStatus("请先选择输出文件夹，再保存本地日志 TXT。", "err"); return; }
        try {
            var fs = window.cep && window.cep.fs;
            if (!fs || typeof fs.writeFile !== "function") throw new Error("本地文件接口不可用，可复制日志。");
            var stamp = new Date().toISOString().replace(/[:.]/g, "-");
            var target = settings.folder.replace(/[\/\\]+$/, "") + "/MarkerExport-1.1.9-log-" + stamp + ".txt";
            var response = fs.writeFile(target, "\ufeff" + logText.value, "UTF8");
            if (!response || response.err !== 0) throw new Error("写入失败，错误码 " + (response && response.err));
            setStatus("日志已保存：" + target + "\n不会自动上传。", "ok");
        } catch (e) { setStatus("保存日志失败：" + e.message, "err"); }
    });
    render();
    if (!window.__adobe_cep__) { busy = true; render(); setStatus("请从 Premiere 的“窗口 → 扩展”打开“Premiere ClipOut · 剪辑批量导出”。", "err"); }
    else refreshPresets();
})();
