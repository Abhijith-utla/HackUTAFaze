param([Parameter(Mandatory=$true)][string]$Path, [string]$Method='GET', [string]$BodyFile)
$ErrorActionPreference='Stop'
$reply = "protocol=https`nhost=github.com`n`n" | git credential fill
$fields=@{}
foreach($line in $reply){$pair=$line -split '=',2;if($pair.Length -eq 2){$fields[$pair[0]]=$pair[1]}}
if(-not $fields['password']){throw 'Existing GitHub credential unavailable'}
$headers=@{Authorization='Bearer '+$fields['password'];Accept='application/vnd.github+json'}
$params=@{Uri=('https://api.github.com/'+$Path.TrimStart('/'));Method=$Method;Headers=$headers}
if($BodyFile){$params.ContentType='application/json';$params.Body=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $BodyFile))}
$result=Invoke-RestMethod @params
ConvertTo-Json -InputObject $result -Depth 30
