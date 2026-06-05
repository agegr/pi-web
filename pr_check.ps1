[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$r = Invoke-RestMethod 'https://api.github.com/repos/agegr/pi-web/pulls/39' -TimeoutSec 10
Write-Host "Title: $($r.title)"
Write-Host "State: $($r.state)"
Write-Host "Body:"
Write-Host $r.body
