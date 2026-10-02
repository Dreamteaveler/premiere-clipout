(function () {
    var cs = new CSInterface(), busy = false;
    var buildLabel = document.getElementById("buildVersion"), build = window.MarkerExportBuild;
    if (buildLabel && build) buildLabel.textContent = build.version;
    if (window.MarkerExportLog && typeof window.MarkerExportLog.add === "function") window.MarkerExportLog.add("SESSION", "frontend", "client.js", "", "executedClientVersion=1.1.10");
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
        var summary = /Queued (\d+) of (\d+) jobs\. Skipped (\d+)\. Failed (\d+)\./.exec(text);
        var head = text.split(/\r?\n/)[0], count = /Queued (\d+) of (\d+) jobs/.exec(text);
        if (head.length > 110) head = head.substr(0, 107) + "…";
        if (summary) head = "已入队 " + summary[1] + "；跳过 " + summary[3] + "；提交失败 " + summary[4] + "。请查看详情。";
        else if (count) head += "（已入队 " + count[1] + "/" + count[2] + "）";
        status.textContent = head; status.className = kind || "";
        status.setAttribute("role", kind === "err" ? "alert" : "status");
        status.setAttribute("aria-live", kind === "err" ? "assertive" : "polite");
        statusFull.textContent = text;
        statusDetails.hidden = !text || text === head;
        statusDetails.open = (kind === "err" || kind === "warn") && !statusDetails.hidden;
        statusDetailLabel.textContent = kind === "err" ? "错误详情" : "查看结果详情";
    }
    function effectivePresets() { return bundled; }
    function name(path) { return path ? path.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() : "尚未选择"; }
    function refreshPresets(afterReady) {
        if (busy) return;
        bundled = {}; render(); setStatus("正在检测与当前 Premiere 匹配的 AME…");
        host("app.version + \"\\t\" + Folder.startup.fsName", function (identity) {
            if (/^ERROR:|^EvalScript error/i.test(identity)) { bundled={};render();result(identity);return; }
            var fields=identity.split("\t"), encoder;
            try {
                if(fields.length!==2) throw new Error("无法确认当前 Premiere 版本与安装位置，未提交导出。");
                var load=window.cep_node && window.cep_node.require ? function(name){return window.cep_node.require(name);} : (typeof require === "function" ? require : null);
                encoder=window.EncoderDiscovery.find(fields[0],fields[1],load);
            } catch(e) { bundled={}; render(); setStatus(e.message,"err"); return; }
            var base=encoder.path.replace(/\\/g,"/")+"/MediaIO/systempresets/";
            var video=base+"4E49434B_48323634/01 - Match Source - High bitrate.epr", audio=base+"3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr";
            host("(function(){var v=File("+quote(video)+"),a=File("+quote(audio)+");return v.exists && a.exists ? 'OK' : 'MISSING';})()",function(result){
                if(result!=="OK"){bundled={};render();setStatus("已找到与当前 Premiere 匹配的 AME，但 H.264 / WAV 系统预设缺失，未提交导出。请检查 AME 安装完整性。","err");return;}
                bundled={video:video,audio:audio};render();setStatus("本机匹配的 AME 格式已就绪，请核对输出文件夹。");if(typeof afterReady === "function")afterReady();
            });
        });
    }

    function quote(value) { return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
    function render() {
        mode.value = settings.mode; scope.value = settings.scope;
        folderPath.value = settings.folder || folderPath.value || "";
        var clipMode = settings.mode === "clipboundary";
        document.getElementById("scopeRow").hidden = !clipMode;
        document.getElementById("hint").textContent = clipMode ?
            "有真实链接的视频与音频合并导出；未链接音频单独导出。每项仅保留目标片段及真实关联音频，支持嵌套／多机位实例。" :
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
            .replace(/Native graphic jobs: (\d+)\./g, "原生图形任务：$1 项。")
            .replace(/Single-sided transitions retained: (\d+)\./g, "计划保留单边转场：$1 处。")
            .replace(/Sequence-source jobs: (\d+)\./g, "嵌套／多机位任务：$1 项。")
            .replace(/Task groups: (\d+); planned=(\d+); skipped=(\d+)\./g, "任务组：$1；计划 $2；跳过 $3。")
            .replace(/A two-sided or unclassified transition requires neighboring clip context; this job is skipped\./g, "该双边或未分类转场依赖邻接片段，当前版本尚未实现所需上下文，已跳过此任务。")
            .replace(/Cross-track matte dependency is not supported by target-only isolation; matte context must be preserved explicitly\./g, "该效果依赖其他轨道的遮罩；当前隔离方式尚未保留遮罩上下文，已跳过此任务。")
            .replace(/Cannot prove transition sides/g, "无法核实转场的单边方向")
            .replace(/Clone does not preserve the native transition and its exact boundaries\./g, "序列副本未通过原生转场及精确边界校验，尚未入队。")
            .replace(/sequence frames: /g, "序列帧：")
            .replace(/\(Out exclusive\)/g, "（出点不含）")
            .replace(/ticks\/frame=/g, "每帧 ticks=")
            .replace(/independent audio sample grid: ticks\/sample=/g, "独立音频采样：每样本 ticks=")
            .replace(/; no video-frame rounding/g, "；不按视频帧截断")
            .replace(/ frames; /g, " 帧； ")
            .replace(/^Queued (\d+) export\(s\) in Adobe Media Encoder\. Queue NOT started\./, "已将 $1 项任务加入 AME，尚未开始编码。")
            .replace(/Queued (\d+) of (\d+) jobs\. Skipped (\d+)\. Failed (\d+)\./g, "本轮已入队 $1/$2 个有效任务；跳过 $3 个任务组；提交失败 $4 个。")
            .replace(/Timeline inventory: (\d+) clips in the active sequence; scope=(selected|all)\. Linked AV counts as one task group\./g, "当前序列时间线共 $1 个片段；范围=$2。真实链接 AV 按一个任务组计数。")
            .replace(/scope=all/g, "范围=全部片段")
            .replace(/scope=selected/g, "范围=已选片段")
            .replace(/SNAPSHOT exactSourceTicks=(\d+) declaredSourceFrames=(\d+) serializedTimeline=(\d+) unknown=(\d+)/g, "快照状态：源 ticks 对应 $1；源帧对应 $2；时间线帧序列化对应 $3；未知 $4")
            .replace(/Skipped (\d+)\./g, "跳过 $1 个任务组。")
            .replace(/^SKIP /gm, "跳过：")
            .replace(/^FAIL /gm, "提交失败：")
            .replace(/already submitted or acknowledgement uncertain; not submitted again\./g, "本会话已提交或回执不确定；为避免重复，不再提交。")
            .replace(/Queue NOT started\. Accepted job IDs confirm submission only; final AME encoding results are not observed\./g, "未自动启动 AME 队列。任务 ID 仅证明接受入队；未监测实际编码完成或失败。")
            .replace(/Output folder: /g, "输出目录：")
            .replace(/^ERROR:/, "错误：")
            .replace(/Cannot identify a clip\'s source project item\./g, "无法确认该片段的源项目项：")
            .replace(/; nothing was queued\. Source identity is required; no name\/path matching or clip skipping\./g, "；尚未入队，不会按名称猜源或跳过片段。")
            .replace(/Premiere changed exact export boundaries \(frame\/sample rounding\); this job was not queued\./g, "Premiere 读回边界未通过帧／样本校验；尚未入队。")
            .replace(/Cannot inspect clip enabled state\./g, "无法确认片段启用状态：")
            .replace(/A requested linked clip is disabled; enable it or change the selection\./g, "该任务组包含真实禁用片段，已跳过：")
            .replace(/snapshot has no exact unambiguous state mapping\./g, "序列快照中没有精确且唯一的状态对应，未猜测启用状态。")
            .replace(/A requested source is offline\./g, "当前序列中请求的源素材被报告为离线：")
            .replace(/Cannot inspect source offline state\./g, "无法确认源素材离线状态：")
            .replace(/Preset has no valid export file extension; no fallback format will be guessed\./g, "预设未返回有效扩展名，请检查所选 .epr；没有自动猜测格式。")
            .replace(/ \| timeline /g, " | 时间线 ")
            .replace(/  video source In\/Out: /g, "  视频源范围：")
            .replace(/  audio source In\/Out: /g, "  音频源范围：");
        var counts = /Queued (\d+) of (\d+) jobs\. Skipped (\d+)\. Failed (\d+)\./.exec(text);
        if (counts) localized = "已入队 " + counts[1] + "；跳过 " + counts[3] + "；提交失败 " + counts[4] + "。\n" + localized;
        setStatus(localized, /^ERROR:|^EvalScript error/i.test(text) || !text ? "err" : /Skipped [1-9]\d*\./.test(text) ? "warn" : "ok");
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
    refreshBtn.addEventListener("click", function(){refreshPresets();});
    previewBtn.addEventListener("click", function () { if (busy) return; setStatus("正在读取剪辑边界、真实链接与计划文件名…"); host("previewClipExports(" + [quote(settings.scope), quote(effectivePresets().video), quote(effectivePresets().audio)].join(",") + ")", result); });
    diagnoseBtn.addEventListener("click", function () { setStatus("只读检查当前序列与已有副本，不入队…"); host("diagnoseExportBoundaries(" + quote(settings.scope) + ")", result); });
    exportBtn.addEventListener("click", function () { if (busy) return;
        refreshPresets(function(){
            var effective = effectivePresets(), args = [quote(settings.folder), quote(effective.video)];
            var fn = "exportMarkersAsClips";
            if (settings.mode === "clipboundary") { fn = "exportClipsAsFiles"; args.push(quote(effective.audio), quote(settings.scope)); }
            setStatus("正在准备隔离序列并加入队列…"); host(fn + "(" + args.join(",") + ")", result);
        });
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
            var target = settings.folder.replace(/[\/\\]+$/, "") + "/MarkerExport-1.1.10-log-" + stamp + ".txt";
            var response = fs.writeFile(target, "\ufeff" + logText.value, "UTF8");
            if (!response || response.err !== 0) throw new Error("写入失败，错误码 " + (response && response.err));
            setStatus("日志已保存：" + target + "\n不会自动上传。", "ok");
        } catch (e) { setStatus("保存日志失败：" + e.message, "err"); }
    });
    render();
    if (!window.__adobe_cep__) { busy = true; render(); setStatus("请从 Premiere 的“窗口 → 扩展”打开“Premiere ClipOut · 剪辑批量导出”。", "err"); }
    else refreshPresets();
})();
