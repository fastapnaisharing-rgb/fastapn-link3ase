# FastAPN Outlook Handler
# วางไว้ที่ D:\apps\fastapn-outlook.ps1
param([string]$Uri)
try {
  $raw=($Uri -replace '^fastapn://','') -replace '/$',''; $p=@{}
  foreach($x in $raw -split '&'){$kv=$x -split '=',2; if($kv.Count -eq 2){$p[$kv[0]]=[System.Uri]::UnescapeDataString($kv[1])}}
  $to=$p['to'];$cc=$p['cc'];$subj=$p['subject'];$body=$p['body'];$ids=$p['attachIds'] -split ',';$namesRaw=$p['attachNames'] -split ',';$tok=$p['token'];$api=$p['apiBase'].TrimEnd('/');$mode=$p['sendMode']
  if(-not(Test-Path 'D:\apps')){New-Item -ItemType Directory -Path 'D:\apps'|Out-Null}
  $tmp='D:\tmp\fastapn-attach'; if(-not(Test-Path $tmp)){New-Item -ItemType Directory -Path $tmp|Out-Null}
  $paths=@()
  for($i=0;$i -lt $ids.Count;$i++){$id=$ids[$i].Trim();if(-not $id){continue};$url="$api/api/file-storage/$id/download";$rawName=if($namesRaw.Count -gt $i -and $namesRaw[$i]){[System.Uri]::UnescapeDataString($namesRaw[$i])}else{"$id.xls"};$safeName=[System.IO.Path]::GetFileName($rawName);if(-not $safeName){$safeName="$id.xls"};$f="$tmp\$safeName"
    try{Invoke-WebRequest -Uri $url -Headers @{Authorization="Bearer $tok"} -OutFile $f -UseBasicParsing;$paths+=$f}catch{"$(Get-Date -Format s) id=$id url=$url err=$($_.Exception.Message)" | Out-File -FilePath "$tmp\debug.log" -Append -Encoding utf8}}
  $ol=New-Object -ComObject Outlook.Application;$mail=$ol.CreateItem(0)
  $mail.To=$to;if($cc){$mail.CC=$cc};$mail.Subject=$subj;$bodyHtml=$body -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '
','<br>' -replace '
','<br>';$hr=$p['bodyHtml'];if($hr){$mail.HTMLBody=$hr}else{$mail.HTMLBody='<div style="font-family:Tahoma;font-size:10pt">' + $bodyHtml + '</div>'} 
  foreach($path in $paths){if(Test-Path $path){$mail.Attachments.Add($path)|Out-Null}}
  if($mode -eq 'send'){$mail.Send()}else{$mail.Display()}
}catch{Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.MessageBox]::Show("FastAPN Error: $_","Error")}