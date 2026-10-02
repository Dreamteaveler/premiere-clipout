(function(root){
    function label(major) { return major === 15 ? '2021' : major >= 22 ? String(2000 + major) : major === 14 ? '2020' : major === 13 ? '2019' : '主版本 ' + major; }
    function find(hostVersion, startup, load) {
        var major = parseInt(hostVersion, 10);
        if (!major || major < 1) throw new Error('无法确认当前 Premiere 版本，未提交导出。');
        if (typeof load !== 'function') throw new Error('无法检测本机 AME：CEP Node 功能不可用，未提交导出。');
        // Read-only application discovery. No registry writes, policy changes or shell interpolation.
        var quote = function(s) { return "'" + String(s).replace(/'/g,"''") + "'"; };
        var script = [
            "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding; $paths=New-Object 'System.Collections.Generic.List[string]'",
            "$parents=@($env:ProgramW6432+'/Adobe',$env:ProgramFiles+'/Adobe',"+quote(startup+'/..')+")",
            "foreach($parent in $parents){if(Test-Path -LiteralPath $parent){Get-ChildItem -LiteralPath $parent -Directory -Filter 'Adobe Media Encoder*' -ErrorAction SilentlyContinue | ForEach-Object {$paths.Add((Join-Path $_.FullName 'Adobe Media Encoder.exe'))}}}",
            "foreach($hive in @('HKLM:','HKCU:')){foreach($prefix in @('Software','Software/WOW6432Node')){",
            "$app=Get-ItemProperty -LiteralPath ($hive+'/'+$prefix+'/Microsoft/Windows/CurrentVersion/App Paths/Adobe Media Encoder.exe') -ErrorAction SilentlyContinue;if($app -and $app.'(default)'){$paths.Add($app.'(default)'.Trim('\"'))}",
            "$items=Get-ItemProperty -Path ($hive+'/'+$prefix+'/Microsoft/Windows/CurrentVersion/Uninstall/*') -ErrorAction SilentlyContinue;foreach($item in $items){if($item.DisplayName -like '*Adobe Media Encoder*' -and $item.InstallLocation){$paths.Add((Join-Path $item.InstallLocation.Trim('\"') 'Adobe Media Encoder.exe'))}}}}",
            "$results=@(foreach($file in ($paths|Select-Object -Unique)){if(Test-Path -LiteralPath $file -PathType Leaf){try{$v=[Diagnostics.FileVersionInfo]::GetVersionInfo($file);if($v.ProductMajorPart -gt 0){[pscustomobject]@{major=$v.ProductMajorPart;path=[IO.Path]::GetDirectoryName($file);version=$v.ProductVersion}}}catch{}}});ConvertTo-Json -InputObject $results -Compress"
        ].join('\n');
        var list;
        try {
            var processModule=load('child_process');
            list=JSON.parse(String(processModule.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024})).replace(/^\uFEFF/,''));
        } catch(e) { throw new Error('无法检测本机 AME 安装信息，未提交导出：'+e.message); }
        if (Object.prototype.toString.call(list) !== '[object Array]') throw new Error('AME 检测返回无效数据，未提交导出。');
        for(var i=0;i<list.length;i++) if(Number(list[i].major)===major && typeof list[i].path==='string' && list[i].path) return list[i];
        throw new Error('当前 Premiere '+label(major)+' 必须安装相同主版本的 AME '+label(major)+' 才能导出；未找到匹配版本，未加入队列。补丁号无需一致。');
    }
    var api={find:find,label:label};
    root.EncoderDiscovery=api;
    if(typeof module==='object' && module.exports)module.exports=api;
}(this));
